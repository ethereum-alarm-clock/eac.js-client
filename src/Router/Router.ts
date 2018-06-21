import Actions from '../Actions';
import Config from '../Config';
import { TxStatus } from '../Enum';
import { shouldClaimTx } from '../EconomicStrategy';

import W3Util from '../Util';
import { ITxRequest } from '../Types';

export class TEMPORAL_UNIT {
  static BLOCK = 1;
  static TIMESTAMP = 2;
}

export default class Router {
  actions: Actions;
  config: Config;
  util: W3Util;
  txRequestStates: Object = {};

  transitions: Object = {};

  constructor(config: Config, actions: any) {
    this.actions = actions;
    this.config = config;
    this.util = config.util;

    this.transitions[TxStatus.BeforeClaimWindow] = this.beforeClaimWindow.bind(
      this
    );
    this.transitions[TxStatus.ClaimWindow] = this.claimWindow.bind(this);
    this.transitions[TxStatus.FreezePeriod] = this.freezePeriod.bind(this);
    this.transitions[TxStatus.ExecutionWindow] = this.executionWindow.bind(
      this
    );
    this.transitions[TxStatus.Executed] = this.executed.bind(this);
    this.transitions[TxStatus.Missed] = this.missed.bind(this);
    this.transitions[TxStatus.Done] = (txRequest: any) => {
      this.config.logger.info(
        `[${txRequest.address}] Finished. Deleting from cache...`
      );
      this.config.cache.del(txRequest.address);
      return TxStatus.Done;
    };
  }

  async beforeClaimWindow(txRequest: any): Promise<TxStatus> {
    if (txRequest.isCancelled) {
      // TODO Status.CleanUp?
      return TxStatus.Executed;
    }

    if (await txRequest.beforeClaimWindow()) {
      return TxStatus.BeforeClaimWindow;
    }

    return TxStatus.ClaimWindow;
  }

  async claimWindow(txRequest: any): Promise<TxStatus> {
    if (!(await txRequest.inClaimWindow())) {
      return TxStatus.FreezePeriod;
    }
    if (txRequest.isClaimed) {
      return TxStatus.FreezePeriod;
    }

    const shouldClaim = await shouldClaimTx(txRequest, this.config);

    if (shouldClaim) {
      try {
        const claimed = await this.actions.claim(txRequest);

        if (claimed === true) {
          this.config.logger.info(`${txRequest.address} claimed`);
        }
      } catch (e) {
        this.config.logger.error(`${txRequest.address} claiming failed`);
        // TODO handle gracefully?
        throw new Error(e);
      }
    } else {
      this.config.logger.info(
        `[${txRequest.address}] not profitable to claim.`
      );
      this.config.logger.debug(
        `ECONOMIC STRATEGY: ${JSON.stringify(this.config.economicStrategy)}`
      );
    }

    return TxStatus.ClaimWindow;
  }

  async freezePeriod(txRequest: any): Promise<TxStatus> {
    if (await txRequest.inFreezePeriod()) {
      return TxStatus.FreezePeriod;
    }

    if (await txRequest.inExecutionWindow()) {
      return TxStatus.ExecutionWindow;
    }

    return TxStatus.FreezePeriod;
  }

  async inReservedWindowAndNotClaimedLocally(txRequest: any): Promise<Boolean> {
    const inReserved = await txRequest.inReservedWindow();
    return inReserved && txRequest.isClaimed && !this.isLocalClaim(txRequest);
  }

  async executionWindow(txRequest: any): Promise<TxStatus> {
    if (txRequest.wasCalled) {
      return TxStatus.Executed;
    }
    if (await this.isTransactionMissed(txRequest)) {
      return TxStatus.Missed;
    }

    if (await this.inReservedWindowAndNotClaimedLocally(txRequest)) {
      return TxStatus.ExecutionWindow;
    }

    try {
      const executed = await this.actions.execute(txRequest);

      if (executed === true) {
        this.config.logger.info(`${txRequest.address} executed`);

        return TxStatus.Executed;
      }
    } catch (e) {
      this.config.logger.error(`${txRequest.address} execution failed`);

      //TODO handle gracefully?
      throw new Error(e);
    }

    return TxStatus.ExecutionWindow;
  }

  async executed(txRequest: any): Promise<TxStatus> {
    /**
     * We don't cleanup because cleanup needs refactor according to latest logic in EAC
     * https://github.com/ethereum-alarm-clock/ethereum-alarm-clock/blob/master/contracts/Library/RequestLib.sol#L433
     *
     * await this.actions.cleanup(txRequest);
     */
    //

    return TxStatus.Done;
  }

  async missed(txRequest: any): Promise<TxStatus> {
    // TODO cleanup
    return TxStatus.Done;
  }

  async isTransactionMissed(txRequest: any): Promise<boolean> {
    const afterExecutionWindow =
      parseInt(txRequest.executionWindowEnd) <= parseInt(await txRequest.now());
    return Boolean(afterExecutionWindow && !txRequest.wasCalled);
  }

  isLocalClaim(txRequest: any): boolean {
    const localClaim = this.config.wallet.isKnownAddress(txRequest.claimedBy);

    if (!localClaim) {
      this.config.logger.debug(
        `[${
          txRequest.address
        }] In reserve window and not claimed by this TimeNode.`
      );
    }

    return localClaim;
  }

  async route(txRequest: ITxRequest): Promise<any> {
    let status: TxStatus =
      this.txRequestStates[txRequest.address] || TxStatus.BeforeClaimWindow;

    const statusFunction = this.transitions[status];
    let nextStatus: TxStatus = await statusFunction(txRequest);

    while (nextStatus !== status) {
      this.config.logger.info(
        `${txRequest.address} Transitioning from  ${TxStatus[status]} to ${
          TxStatus[nextStatus]
        } (${nextStatus})`
      );
      status = nextStatus;
      nextStatus = await this.transitions[status](txRequest);
    }

    this.txRequestStates[txRequest.address] = nextStatus;
    return nextStatus;
  }
}
