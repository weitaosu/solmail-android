import { type PropsWithChildren, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { type Transaction, type VersionedTransaction, PublicKey } from '@solana/web3.js';
import { toByteArray } from 'react-native-quick-base64';
import { CHAIN, APP_IDENTITY, withWallet } from './mwa';
import { clearAuthToken, getAuthToken, setAuthToken } from './auth-token-store';

type WalletAccount = {
  address: string;
  publicKey: PublicKey;
};

type MobileWalletContextType = {
  account: WalletAccount | null;
  connect: () => Promise<WalletAccount>;
  signIn: () => Promise<{ address: string }>;
  disconnect: () => Promise<void>;
  signAndSendTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<string[]>;
};

const MobileWalletContext = createContext<MobileWalletContextType | null>(null);
const WALLET_TIMEOUT_MS = 25000;

function withTimeout<T>(promise: Promise<T>, ms = WALLET_TIMEOUT_MS) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error('Wallet request timed out. Check wallet app/network and try again.'));
      }, ms);
    }),
  ]);
}

async function authorizeWithFallback(wallet: {
  authorize: (args: {
    chain: string;
    identity: { name: string; uri: string; icon: string };
    auth_token?: string;
  }) => Promise<{ auth_token: string; accounts: { address: string }[] }>;
}) {
  const stored = await getAuthToken();
  try {
    const next = await wallet.authorize({
      chain: CHAIN,
      identity: APP_IDENTITY,
      auth_token: stored || undefined,
    });
    await setAuthToken(next.auth_token);
    return next;
  } catch (error) {
    // Cached auth tokens can go stale; retry once without token.
    if (stored) {
      await clearAuthToken();
      const fresh = await wallet.authorize({
        chain: CHAIN,
        identity: APP_IDENTITY,
      });
      await setAuthToken(fresh.auth_token);
      return fresh;
    }
    throw error;
  }
}

export function MobileWalletProvider({ children }: PropsWithChildren) {
  const [account, setAccount] = useState<WalletAccount | null>(null);

  const connect = useCallback(async () => {
    const auth = await withTimeout(withWallet(async (wallet) => authorizeWithFallback(wallet)));
    const address = auth.accounts[0]?.address;
    if (!address) throw new Error('No wallet account returned by authorize()');
    const nextAccount = {
      address,
      publicKey: new PublicKey(toByteArray(address)),
    };
    setAccount(nextAccount);
    return nextAccount;
  }, []);

  const signIn = useCallback(async () => {
    const auth = await withTimeout(
      withWallet(async (wallet) => {
        const result = await wallet.authorize({
          chain: CHAIN,
          identity: APP_IDENTITY,
          sign_in_payload: {
            domain: 'solmail.com',
            statement: 'Sign in to SolMail',
            uri: 'https://solmail.com',
          },
        });
        await setAuthToken(result.auth_token);
        return result;
      }),
    );
    const address = auth.accounts[0]?.address;
    if (!address) throw new Error('No wallet account returned by sign-in');
    const nextAccount = {
      address,
      publicKey: new PublicKey(toByteArray(address)),
    };
    setAccount(nextAccount);
    return { address };
  }, []);

  const disconnect = useCallback(async () => {
    const stored = await getAuthToken();
    if (stored) {
      await withTimeout(withWallet((wallet) => wallet.deauthorize({ auth_token: stored })));
    }
    await clearAuthToken();
    setAccount(null);
  }, []);

  const signAndSendTransactions = useCallback(
    async (txs: (Transaction | VersionedTransaction)[]) => {
      return withTimeout(
        withWallet(async (wallet) => {
          const auth = await authorizeWithFallback(wallet);
          await setAuthToken(auth.auth_token);
          const signatures = await wallet.signAndSendTransactions({
            transactions: txs,
          });
          return signatures;
        }),
      );
    },
    [],
  );

  const value = useMemo(
    () => ({ account, connect, signIn, disconnect, signAndSendTransactions }),
    [account, connect, disconnect, signAndSendTransactions, signIn],
  );

  return <MobileWalletContext.Provider value={value}>{children}</MobileWalletContext.Provider>;
}

export function useMobileWallet() {
  const context = useContext(MobileWalletContext);
  if (!context) {
    throw new Error('useMobileWallet must be used inside MobileWalletProvider');
  }
  return context;
}
