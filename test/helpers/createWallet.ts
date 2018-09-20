import { Wallet } from '../../src/index';

export function createWalletKeystore(num: number, password: string) {
  const wallet = new Wallet(null, null, null);
  wallet.create(num);

  return wallet.encrypt(password, {});
}

export function createWallet(num: number) {
  const wallet = new Wallet(null, null, null);
  wallet.create(num);
  return wallet;
}
