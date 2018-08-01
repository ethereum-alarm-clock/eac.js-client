import BigNumber from 'bignumber.js';
import Config from '../Config';
import { isExecuted, isTransactionStatusSuccessful } from './Helpers';
import hasPending from './Pending';
import { IWalletReceipt } from '../Wallet';
import { ExecuteStatus, ClaimStatus } from '../Enum';

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(address.length - 5, address.length)}`;
}

export default class Actions {
  public config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  public async claim(txRequest: any): Promise<ClaimStatus> {
    // Check if claiming is turned off.
    if (!this.config.claiming) {
      return ClaimStatus.NOT_ENABLED;
    }

    const requiredDeposit = txRequest.requiredDeposit;
    // TODO make this a constant
    const claimData = txRequest.claimData;

    // Gas needed ~ 89k, this provides a buffer... just in case
    const gasEstimate = 120000;

    const opts = {
      to: txRequest.address,
      value: requiredDeposit,
      gas: gasEstimate,
      gasPrice: await this.config.util.networkGasPrice(),
      data: claimData
    };

    if (await hasPending(this.config, txRequest, { type: 'claim' })) {
      return ClaimStatus.PENDING;
    }

    if (this.config.wallet.isNextAccountFree()) {
      try {
        // this.config.logger.debug(`[${txRequest.address}] Sending claim transactions with opts: ${JSON.stringify(opts)}`);
        const { receipt, from, error } = await this.config.wallet.sendFromNext(opts);
        // this.config.logger.debug(`[${txRequest.address}] Received receipt: ${JSON.stringify(receipt)}\n And from: ${from}`);

        if (error) {
          this.config.logger.debug(
            `Actions::claim(${shortenAddress(txRequest.address)})::sendFromNext error: ${error}`
          );
          return ClaimStatus.FAILED;
        }

        if (isTransactionStatusSuccessful(receipt.status)) {
          await txRequest.refreshData();
          const cost = new BigNumber(receipt.gasUsed).mul(
            new BigNumber(txRequest.data.txData.gasPrice)
          );

          this.config.cache.get(txRequest.address).claimedBy = from;

          this.config.statsDb.updateClaimed(from, cost);

          if (txRequest.isClaimed) {
            return ClaimStatus.SUCCESS;
          }
        }

        return ClaimStatus.FAILED;
      } catch (err) {
        this.config.logger.debug(
          `Actions::claim(${shortenAddress(txRequest.address)})::sendFromIndex error: ${err}`
        );
        return ClaimStatus.FAILED;
      }
    } else {
      this.config.logger.debug(
        `Actions::claim(${shortenAddress(
          txRequest.address
        )})::Wallet with index 0 is not able to send tx.`
      );
      return ClaimStatus.FAILED;
    }

    //TODO get transaction object from txHash
  }

  public async execute(txRequest: any): Promise<any> {
    const gasToExecute = txRequest.callGas
      .add(180000)
      .div(64)
      .times(65)
      .round();
    // TODO Check that the gasToExecue < gasLimit of latest block w/ some margin

    // TODO make this a constant
    const executeData = txRequest.executeData;

    const claimIndex = this.config.wallet.getAddresses().indexOf(txRequest.claimedBy);
    this.config.logger.debug(`Claim Index ${claimIndex}`);

    const opts = {
      to: txRequest.address,
      value: 0,
      gas: gasToExecute,
      gasPrice: txRequest.gasPrice,
      data: executeData
    };

    if (
      await hasPending(this.config, txRequest, {
        type: 'execute',
        exactPrice: opts.gasPrice
      })
    ) {
      return ExecuteStatus.PENDING;
    }

    const handleTransactionReturn = async (
      walletReceipt: IWalletReceipt
    ): Promise<ExecuteStatus> => {
      const { receipt, from, error } = walletReceipt;

      if (error) {
        this.config.logger.debug(`Actions.execute: ${ExecuteStatus.FAILED}`);
        return ExecuteStatus.FAILED;
      }

      if (isTransactionStatusSuccessful(receipt.status)) {
        let bounty = new BigNumber(0);
        let cost = new BigNumber(0);

        if (isExecuted(receipt)) {
          await txRequest.refreshData();

          const data = receipt.logs[0].data;
          bounty = this.config.web3.toDecimal(data.slice(0, 66));

          const cached = this.config.cache.get(txRequest.address);

          if (cached) {
            cached.wasCalled = true;
          }
        } else {
          // If not executed, must add the gas cost into cost. Otherwise, TimeNode was
          // reimbursed for gas.
          cost = new BigNumber(receipt.gasUsed).mul(new BigNumber(txRequest.data.txData.gasPrice));
        }

        this.config.statsDb.updateExecuted(from, bounty, cost);

        if (txRequest.wasSuccessful) {
          return ExecuteStatus.SUCCESS;
        }
      }

      return ExecuteStatus.FAILED;
    };

    if (claimIndex !== -1) {
      const walletReceipt = await this.config.wallet.sendFromIndex(claimIndex, opts);

      return await handleTransactionReturn(walletReceipt);
    }

    if (this.config.wallet.isNextAccountFree()) {
      const walletReceipt = await this.config.wallet.sendFromNext(opts);

      return await handleTransactionReturn(walletReceipt);
    } else {
      this.config.logger.debug('Actions.execute : No available wallet to send a transaction.');
    }
  }

  public async cleanup(txRequest: any): Promise<boolean> {
    throw Error('Not implemented according to latest EAC changes.');

    // Check if there is any ether left in a txRequest.
    const txRequestBalance = await txRequest.getBalance();

    if (txRequestBalance.equals(0)) {
      return true;
    }

    if (txRequest.isCancelled) {
      return true;
    } else {
      // Cancel it!
      const gasEstimate = await this.config.util.estimateGas({
        to: txRequest.address,
        data: txRequest.cancelData
      });

      // Get latest block gas price.
      const estGasPrice = await this.config.util.networkGasPrice();

      const gasCostToCancel = estGasPrice.times(gasEstimate);

      const opts = {
        to: txRequest.address,
        value: 0,
        gas: gasEstimate + 21000,
        gasPrice: estGasPrice,
        data: txRequest.cancelData // TODO make constant
      };

      // Check to see if any of our accounts is the owner.
      const ownerIndex = this.config.wallet.getAddresses().indexOf(txRequest.owner);
      if (ownerIndex !== -1) {
        const { error } = await this.config.wallet.sendFromIndex(ownerIndex, opts);
        if (error) {
          return;
        }
      } else {
        if (gasCostToCancel.greaterThan(txRequestBalance)) {
          // The txRequest doesn't have high enough balance to compensate.
          // It's now considered dust.
          return true;
        }
        const { error } = await this.config.wallet.sendFromNext(opts);
        if (error) {
          return;
        }
      }

      //TODO get tx Obj from hash
    }
  }
}
