import { expect, assert } from 'chai';
import Config from '../../src/Config';
import { DefaultLogger } from '../../src/Logger';
import { PRIVATE_KEY, providerUrl } from '../helpers';

const WALLET_PASSWD = 'Wak9bk7DwZYL';
const WALLET_KEYSTORE = `{"version":3,"id":"90ff6d22-668b-492a-bc56-8b560fece46d","address":"487a54e1d033db51c8ee8c03edac2a0f8a6892c6","crypto":{"ciphertext":"115c232498a4f47d10de6c7148b8ebefdac44581b74475bba51675e83d7244dd","cipherparams":{"iv":"b53497a50161315e3fe4f33a9b74c22b"},"cipher":"aes-128-ctr","kdf":"scrypt","kdfparams":{"dklen":32,"salt":"6d6e0329bf255c65c64e9e2face95227ab3221e8648635ac1b65a3c78ce25bbc","n":8192,"r":8,"p":1},"mac":"d771499de6091c8947f8ee9e5e91c3ea9b0b08ed90844c34f77ae2e33b40f40e"}}`;

describe('Config unit tests', () => {
  describe('constructor()', () => {
    it('throws an error when initiating without required params', () => {
      expect(() => new Config({ providerUrl: null })).to.throw();
    });

    it('check all default values are set when empty config', () => {
      const config = new Config({ providerUrl });

      assert.isTrue(config.autostart);
      assert.isFalse(config.claiming);
      assert.equal(config.ms, 4000);
      assert.equal(config.scanSpread, 50);
      assert.isFalse(config.walletStoresAsPrivateKeys);
      assert.isNull(config.client);
      expect(config.logger).to.exist;
      assert.isNull(config.wallet);
    });

    it('check all values are set when added to config object', () => {
      const config = new Config({
        providerUrl,
        autostart: false,
        claiming: true,
        ms: 10000,
        scanSpread: 100,
        walletStoresAsPrivateKeys: true,
        client: 'parity',
        logger: new DefaultLogger(),
        walletStores: [PRIVATE_KEY]
      });

      assert.isFalse(config.autostart);
      assert.isTrue(config.claiming);
      assert.equal(config.ms, 10000);
      assert.equal(config.scanSpread, 100);
      assert.isTrue(config.walletStoresAsPrivateKeys);
      assert.isNotNull(config.client);
      expect(config.logger).to.exist;
      assert.equal(config.wallet.length, 1);
    });

    it('wallet decrypted when using a keystore string', () => {
      const config = new Config({
        providerUrl,
        walletStores: [WALLET_KEYSTORE],
        password: WALLET_PASSWD
      });

      assert.equal(config.wallet.length, 1);
    });

    it('wallet decrypted when using a keystore object', () => {
      const config = new Config({
        providerUrl,
        walletStores: [JSON.parse(WALLET_KEYSTORE)],
        password: WALLET_PASSWD
      });

      assert.equal(config.wallet.length, 1);
    });

    it('throws an error when using a keystore without a password', () => {
      expect(
        () =>
          new Config({
            providerUrl,
            walletStores: [WALLET_KEYSTORE]
          })
      ).to.throw();
    });
  });
});
