import Config from './config';
import hasPending = require('./pending.js');


export default class Actions {
    config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    // async hasPendingTxInTxPool(txRequest): Promise<boolean> {

    // }

    async claim(txRequest): Promise<any> {
        const requiredDeposit = txRequest.requiredDeposit;
        // TODO make this a constant
        const claimData = txRequest.claimData;

        // TODO: estimate gas
        // const estimateGas = await Util.estimateGas()
        const opts = {
            to: txRequest.address,
            value: requiredDeposit,
            //TODO estimate gas above
            gas: 3000000,
            //TODO estimate gas above
            gasPrice: 12,
            data: claimData,
        }

        if (await hasPending(this.config, txRequest)) {
            return {
                ignore: true,
            }
        }
        
        const txHash = await this.config.wallet.sendFromNext(opts)
        //TODO get transaction object from txHash
    }

    async execute(txRequest): Promise<any> {

    }

    async cleanup(txRequest): Promise<any> {

    }
}