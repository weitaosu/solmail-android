import {
  type Web3MobileWallet,
  transact,
} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';

export const APP_IDENTITY = {
  name: process.env.EXPO_PUBLIC_APP_NAME || 'SolMail',
  uri: process.env.EXPO_PUBLIC_APP_URI || 'https://solmail.com',
  icon: process.env.EXPO_PUBLIC_APP_ICON || 'favicon.png',
} as const;

export const CHAIN = process.env.EXPO_PUBLIC_SOLANA_CHAIN || 'solana:devnet';

export async function withWallet<T>(cb: (wallet: Web3MobileWallet) => Promise<T>) {
  return transact(cb);
}
