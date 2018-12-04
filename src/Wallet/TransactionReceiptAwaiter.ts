import { TransactionReceipt } from 'web3/types';
import { Util } from '@ethereum-alarm-clock/lib';

const POLL_INTERVAL = 3000;

export interface ITransactionReceiptAwaiter {
  waitForConfirmations(hash: string, blocks: number): Promise<TransactionReceipt>;
}

export class TransactionReceiptAwaiter implements ITransactionReceiptAwaiter {
  private util: Util;

  public constructor(util: Util) {
    this.util = util;
  }

  public async waitForConfirmations(
    hash: string,
    blocks: number = 12
  ): Promise<TransactionReceipt> {
    return this.awaitTx(hash, {
      ensureNotUncle: true,
      interval: POLL_INTERVAL,
      blocks
    });
  }

  // tslint:disable-next-line:cognitive-complexity
  private awaitTx(hash: string, options: any): Promise<TransactionReceipt> {
    const interval = options && options.interval ? options.interval : 500;
    const transactionReceiptAsync = async (txnHash: string, resolve: any, reject: any) => {
      try {
        const receipt = this.util.getReceipt(txnHash);
        if (!receipt) {
          setTimeout(() => {
            transactionReceiptAsync(txnHash, resolve, reject);
          }, interval);
        } else {
          if (options && options.ensureNotUncle) {
            const resolvedReceipt = await receipt;
            if (!resolvedReceipt || !resolvedReceipt.blockNumber) {
              setTimeout(() => {
                transactionReceiptAsync(txnHash, resolve, reject);
              }, interval);
            } else {
              try {
                const block = await this.util.getBlock(resolvedReceipt.blockNumber);
                const current = await this.util.getBlock('latest');
                if (current.number - block.number >= options.blocks) {
                  const txn = await this.util.getTransaction(txnHash);
                  if (txn.blockNumber != null) {
                    resolve(resolvedReceipt);
                  } else {
                    reject(
                      new Error(
                        'Transaction with hash: ' + txnHash + ' ended up in an uncle block.'
                      )
                    );
                  }
                } else {
                  setTimeout(() => {
                    transactionReceiptAsync(txnHash, resolve, reject);
                  }, interval);
                }
              } catch (e) {
                setTimeout(() => {
                  transactionReceiptAsync(txnHash, resolve, reject);
                }, interval);
              }
            }
          } else {
            resolve(receipt);
          }
        }
      } catch (e) {
        reject(e);
      }
    };

    return new Promise((resolve, reject) => {
      transactionReceiptAsync(hash, resolve, reject);
    });
  }
}
