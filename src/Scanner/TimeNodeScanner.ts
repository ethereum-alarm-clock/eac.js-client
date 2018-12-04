/* eslint no-await-in-loop: 'off' */
import ChainScanner from './ChainScanner';
import Config from '../Config';
import IRouter from '../Router';
import { IntervalId } from '../Types';
import { TxPool } from '../TxPool';
import { Util } from '@ethereum-alarm-clock/lib';

declare const clearInterval: any;
declare const setInterval: any;

export interface ITimeNodeScanner {
  scanning: boolean;
  txPool: TxPool;

  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}

export default class TimeNodeScanner extends ChainScanner implements ITimeNodeScanner {
  public scanning: boolean = false;
  public txPool: TxPool;

  constructor(config: Config, router: IRouter) {
    super(config, router);
    this.txPool = config.txPool;
  }

  public async start(): Promise<boolean> {
    if (!(await Util.isWatchingEnabled(this.config.web3))) {
      throw new Error(
        'Your provider does not support eth_getFilterLogs calls. Please use different provider.'
      );
    }

    await this.txPool.start();

    this.scanning = true;
    this.cacheInterval = await this.runAndSetInterval(() => this.scanCache(), this.config.ms);
    this.chainInterval = await this.runAndSetInterval(() => this.watchBlockchain(), 5 * 60 * 1000);

    // Mark that we've started.
    this.config.logger.info('Scanner STARTED');
    return this.scanning;
  }

  public async stop(): Promise<boolean> {
    if (this.scanning) {
      this.scanning = false;
      // Clear scanning intervals.
      clearInterval(this.cacheInterval);
      clearInterval(this.chainInterval);

      await this.txPool.stop();

      // Mark that we've stopped.
      this.config.logger.info('Scanner STOPPED');
    }

    await this.stopAllWatchers();

    return this.scanning;
  }

  private async runAndSetInterval(fn: () => Promise<void>, interval: number): Promise<IntervalId> {
    if (!this.scanning) {
      this.config.logger.debug('Not starting intervals when TimeNode is intentionally stopped.');
      return null;
    }
    const wrapped = async (): Promise<void> => {
      try {
        await fn();
      } catch (e) {
        this.config.logger.error(e);
      }
    };

    await wrapped();
    return setInterval(wrapped, interval);
  }
}
