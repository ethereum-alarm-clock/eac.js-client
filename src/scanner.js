/* eslint no-await-in-loop: 'off' */
const { routeTxRequest } = require('./routing.js');
const clientVersion = require('../package.json').version;
const SCAN_DELAY = 1;

class Scanner {
  /**
   * Creates a new Scanner instance. The scanner serves as the top level
   * entry point for the EAC-JS TimeNode.
   * @param {Number} ms Milliseconds of the scan interval.
   * @param {Config} config The TimeNode Config object.
   */
  constructor(ms, config) {
    this.ms = ms;
    this.config = config;
    this.log = config.logger;
    this.cache = config.cache;
    this.web3 = config.web3;
    this.eac = config.eac;
    this.logNetwork();

    this.requestFactory = this.config.factory;

    this.log.info(`eac.js-client : version ${clientVersion}`);
    this.log.info(
      `Validating results with factory at ${this.config.factory.address}`
    );
    this.log.info(`Scanning every ${(this.ms * SCAN_DELAY) / 1000} seconds.`);

    this.started = false;
  }

  logNetwork() {
    const Networks = {
      0: 'Private',
      1: 'Mainnet',
      2: 'Mordern',
      3: 'Ropsten',
      4: 'Rinkeby',
      42: 'Kovan',
    };
    this.web3.version.getNetwork((err, res) => {
      if (err) {
        this.log.error(`Unable to connect to a Network`);
      }
      this.log.info(`Network : ${Networks[res || 0]} Network`);
    });

    const provider = this.web3.currentProvider;

    let providerUrl;
    if (provider) {
      providerUrl = provider.host ? provider.host : provider.connection.url;
    } else {
      providerUrl = 'Unknown';
    }

    this.log.info(`Web3 provider : ${providerUrl}`);
  }

  async start() {
    // Reset the intervals if already started.
    if (this.started) this.stop();

    // Set interval for scanning for actionable transaction requests in the cache.
    this.cacheScanning = setInterval(() => {
      this.scanCache().catch((err) => this.log.error(err));
    }, this.ms);

    // Immediately start.
    const watchingEnabled = await new Promise((resolve) => {
      this.web3.currentProvider.sendAsync(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getFilterLogs',
          params: [],
        },
        async (e) => {
          if (e !== null) {
            this.log.info(`Watching DISABLED`);
            resolve(false);
          }
          resolve(true);
        }
      );
    });

    if (watchingEnabled) {
      this.blockchainScanning = this.watchBlockchain();
    } else {
      this.log.info('-Initiating Backup Scanner-');
      // backup scan
      this.blockchainScanning = this.backupScanBlockchain();
    }

    this.scanCache().catch((err) => this.log.error(err));

    // Mark that we've started.
    this.started = true;
    this.log.info('Scanning STARTED');
  }

  async stop() {
    // Clear scanning intervasls.
    clearInterval(this.blockchainScanning);
    clearInterval(this.cacheScanning);
    if (this.requestWatcher) {
      await this.requestFactory.stopWatch(this.requestWatcher);
      this.log.info('Watching STOPPED');
    }

    // Mark that we've stopped.
    this.started = false;
    this.log.info('Scanning STOPPED');
  }

  isValidBlock(block) {
    if (!block) {
      return false;
    }

    return true;
  }

  async isExecutable(txRequest) {
    return (
      (await txRequest.beforeClaimWindow()) ||
      (await txRequest.inClaimWindow()) ||
      (await txRequest.inFreezePeriod()) ||
      (await txRequest.inExecutionWindow())
    );
  }

  getWindowForBlock(latest) {
    const leftBlock = this.getLeftBlock(latest);
    const rightBlock = leftBlock + this.config.scanSpread * 2;

    return { leftBlock, rightBlock };
  }

  getLeftBlock(latest) {
    const leftBlock = latest - this.config.scanSpread;
    return leftBlock < 0 ? 0 : leftBlock;
  }

  getRightTimestamp(leftTimestamp, latestTimestamp) {
    return 2 * latestTimestamp - leftTimestamp;
  }

  // @param request {Object} of form {address: 0xAF...34, uintArgs: uint[12]}
  // async handleRequests (request) {
  //   if (!this.isCorrect(request.address)) return;
  //   this.log.debug(`[${request.address}] Discovered.`)
  //   if (!this.cache.has(request.address)) {
  //     // If it's not already in cache, find windowStart.
  //     this.store(request)
  //   }
  // }

  async backupScanBlockchain() {
    const reqFactory = await this.eac.requestFactory();
    const latestBlock = await this.getBlock('latest');

    const blockBucket = reqFactory.calcBucket(latestBlock.number, 1);
    const tsBucket = reqFactory.calcBucket(latestBlock.timestamp, 2);

    const next = await this.getNextBuckets(latestBlock);

    const handleRequests = (request) => {
      if (!this.isCorrect(request.address)) return;
      this.log.debug(`[${request.address}] Discovered.`);
      if (!this.cache.has(request.address)) {
        // If it's not already in cache, find windowStart.
        this.store(request);
      }
    };
    // console.log(next);
    (await reqFactory.getRequestsByBucket(blockBucket)).map(handleRequests);
    (await reqFactory.getRequestsByBucket(tsBucket)).map(handleRequests);
    (await reqFactory.getRequestsByBucket(next.blockBucket)).map(
      handleRequests
    );
    (await reqFactory.getRequestsByBucket(next.tsBucket)).map(handleRequests);

    return setInterval(() => {
      this.backupScanBlockchain().catch((err) => this.log.error(err));
    }, this.ms);
  }

  async getNextBuckets(block) {
    const reqFactory = await this.eac.requestFactory();

    const blockBucketSize = 240;
    const tsBucketSize = 3600;

    const nextBlockInterval = block.number + blockBucketSize;
    const nextTsInterval = block.timestamp + tsBucketSize;

    const blockBucket = reqFactory.calcBucket(nextBlockInterval, 1);
    const tsBucket = reqFactory.calcBucket(nextTsInterval, 2);

    return {
      blockBucket,
      tsBucket,
    };
  }

  async watchBlockchain() {
    const reqFactory = await this.eac.requestFactory();

    const latestBlock = await this.getBlock('latest');
    // const startBlock = latestBlock.number - this.config.scanSpread

    const blockBucket = reqFactory.calcBucket(latestBlock.number, 1);
    const tsBucket = reqFactory.calcBucket(latestBlock.timestamp, 2);

    const handleRequests = (request) => {
      if (!this.isCorrect(request.address)) return;
      this.log.debug(`[${request.address}] Discovered.`);
      if (!this.cache.has(request.address)) {
        // If it's not already in cache, find windowStart.
        this.store(request);
      }
    };

    // Start watching the current buckets right away.
    reqFactory.watchRequestsByBucket(blockBucket, handleRequests);
    reqFactory.watchRequestsByBucket(tsBucket, handleRequests);
    // Also start watching the next one now.
    this.watchNextBuckets(latestBlock);

    this.log.info(`Watching STARTED`);
    this.log.debug(`Watching for new Requests from current bucket `);

    // Set an timeout for every hour
    return setInterval(async () => {
      const curBlock = await this.getBlock('latest');
      this.watchNextBuckets(curBlock);
    }, 60 * 60 * 1000);
  }

  async watchNextBuckets(block) {
    const reqFactory = await this.eac.requestFactory();

    const next = await this.getNextBuckets(block);

    const handleRequests = (request) => {
      if (!this.isCorrect(request.address)) return;
      this.log.debug(`[${request.address}] Discovered.`);
      if (!this.cache.has(request.address)) {
        // If it's not already in cache, find windowStart.
        this.store(request);
      }
    };

    reqFactory.watchRequestsByBucket(next.blockBucket, handleRequests);
    reqFactory.watchRequestsByBucket(next.tsBucket, handleRequests);
  }

  /**
   * Verifies that a transaction request is valid.
   * @param {String} requestAddress Address of the transaction request.
   */
  isCorrect(requestAddress) {
    // We hit the NULL_ADDRESS so there are no more transaction requests in the tracker.
    if (requestAddress === this.eac.Constants.NULL_ADDRESS) {
      this.log.debug('No new request discovered.');
      return false;
    } else if (!this.eac.Util.checkValidAddress(requestAddress)) {
      // This should, conceivably, never happen unless there is a bug in eac.js-lib.
      throw new Error(
        `[${requestAddress}] Received invalid response from Request Tracker`
      );
    }

    return true;
  }

  // @param request {Object} of form {address: 0xAF...34, uintArgs: uint[12]}
  async fill(request) {
    const txRequest = await this.eac.transactionRequest(request.address);
    txRequest.fillWithParams(request.uintArgs);
    // await txRequest.fillData()

    return txRequest;
  }

  /**
   * Scan is the main driver function of the Scanner class.
   * @param {Number} left The left bound to scan.
   * @param {Number} right The right bound to scan.
   * @param {String} firstRequest Address of a transaction request to start scanning from.
   * @param {Function} shouldStore A function taking windowStart and returning True is the transaction request should be stored.
   * @param {Function} atBound A function taking windowStart and returning True if scanning should continue and False if at bounds.
   * @param {Function} getNext A function taking the currentRequestAddress and returning the next request address.
   * @returns {void}
   */
  async scan(left, right, firstRequest, shouldStore, atBound, getNext) {
    let currentRequestAddress = firstRequest;

    // Return if NULL_ADDRESS and no new transaction requests found.
    if (!this.isCorrect(currentRequestAddress)) return;

    // Loop the cache storage logic while we still get valid transaction requests.
    while (currentRequestAddress !== this.eac.Constants.NULL_ADDRESS) {
      this.log.debug(`[${currentRequestAddress}] Discovered.`);
      // try get the value from cache, fallback to -1 as default
      let windowStart = parseInt(this.cache.get(currentRequestAddress, -1));

      if (windowStart === -1) {
        // If it's not already in cache, find windowStart.
        const txRequest = await this.fill(currentRequestAddress);
        windowStart = txRequest.windowStart;

        if (
          txRequest &&
          shouldStore(windowStart) &&
          this.isExecutable(txRequest)
        ) {
          // If the windowStart returns True to `shouldStore(...)`, store it.
          this.store(txRequest);
        }
      }

      // always check if we already hit bounds
      if (atBound(windowStart)) {
        // Stop looping if we hit the bounds.
        break;
      }

      // Get the next transaction request.
      currentRequestAddress = await getNext(currentRequestAddress);

      // Hearbeat
      if (currentRequestAddress === this.eac.Constants.NULL_ADDRESS) {
        this.log.debug('No new requests discovered.');
        break;
      }
    }
  }

  async scanCache() {
    if (this.cache.len() === 0) return; // nothing stored in cache

    // Get all transaction requests stored in cache and turn them into TransactionRequest objects.
    const allTxRequests = this.cache
      .stored()
      .filter((address) => this.cache.get(address) > 0)
      .map((address) => this.eac.transactionRequest(address));

    // Get fresh data on our transaction requests and route them into appropiate action.
    Promise.all(allTxRequests).then((txRequests) => {
      txRequests.forEach((txRequest) => {
        txRequest
          .refreshData()
          .then(() => routeTxRequest(this.config, txRequest));
      });
    });
  }

  getBlock(number = 'latest') {
    return new Promise((resolve, reject) => {
      this.web3.eth.getBlock(number, (err, block) => {
        if (!err)
          if (block) resolve(block);
          else reject(`Returned block ${number} is null`);
        else reject(err);
      });
    });
  }

  store(request) {
    this.log.info(`[${request.address}] Storing.`);
    this.cache.set(request.address, request.params[7]);
  }
}

module.exports = { Scanner };
