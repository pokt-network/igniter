"use client";

import type { WalletConnection, WalletSettings } from './WalletConnection';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {SignedMemo, SignedTransaction, TransactionMessage} from "../../lib/models/Transactions";
import { PROVIDER_COOKIE_KEY, WALLET_COOKIE_KEY } from './constants';
import { KeplrWalletConnection } from './KeplrWalletConnection';
import {PocketWalletConnection} from "./PocketWalletConnection";
import { setCookie } from '../../lib/cookies'

export interface Provider {
  send: (method: string, params?: any[]) => Promise<any>;
  addListener?: (type: 'accountsChanged', listener: (data: Array<string>) => void) => void;
  removeListener?: (type: 'accountsChanged', listener: (data: Array<string>) => void) => void;
}

export interface ProviderInfo {
  name: string;
  provider: Provider;
  uuid?: string;
  icon?: string;
  rdns?: string;
}
export interface ProviderInfoWithConnection extends ProviderInfo {
  connection: WalletConnectionStatic;
}

export interface WalletConnectionStatic {
  new (provider: Provider, settings: {apiUrl: string, chainId: string}): WalletConnection;
  getAvailableProviders(): Promise<ProviderInfo[]>;
}

export interface WalletConnectionContext {
  isConnected: boolean;
  expectedChainId: string;
  connectedIdentity?: string;
  connectedIdentities?: Array<string>;
  connect(providerInfo: ProviderInfoWithConnection): Promise<Array<string>>;
  connectIdentity(address: string): void;
  clearConnectedIdentity(): void;
  getChain(): Promise<string>;
  getPublicKey(address: string): Promise<string>;
  getBalance(address: string): Promise<number>;
  switchChain(chain: string): Promise<void>;
  signMessage(message: string, address: string): Promise<string>;
  getAvailableProviders(): Promise<ProviderInfoWithConnection[]>;
  signTransaction(messages: TransactionMessage[], signer?: string, memo?: SignedMemo): Promise<SignedTransaction>;
  reconnect(
    address: string,
    wallet: string,
    provider: string
  ): Promise<boolean>;
}

export const WalletConnectionContext = createContext<WalletConnectionContext>({
  isConnected: false,
  expectedChainId: '',
  connect: async () => {
    console.warn('Method not implemented: connect. Something is wrong with the wallet connection provider.');
    return [];
  },
  getChain: async () => {
    console.warn('Method not implemented: getChain. Something is wrong with the wallet connection provider.');
    return '';
  },
  connectIdentity: (address: string) => {
    console.warn('Method not implemented: connectedIdentity. Something is wrong with the wallet connection provider.');
  },
  clearConnectedIdentity: () => {
    console.warn('Method not implemented: clearConnectedIdentity. Something is wrong with the wallet connection provider.');
  },
  getPublicKey: async (address: string) => {
    console.warn('Method not implemented: getPublicKey. Something is wrong with the wallet connection provider.');
    return '';
  },
  getBalance: async (address: string) => {
    console.warn('Method not implemented: getBalance. Something is wrong with the wallet connection provider.');
    return 0;
  },
  switchChain: async () => {
    console.warn('Method not implemented: switchChain. Something is wrong with the wallet connection provider.');
  },
  signMessage: async () => {
    console.warn('Method not implemented: signMessage. Something is wrong with the wallet connection provider.');
    return '';
  },
  getAvailableProviders: async (): Promise<ProviderInfoWithConnection[]> => {
    console.warn('Method not implemented: getProvidersInfo. Something is wrong with the wallet connection provider.');
    return [];
  },
  reconnect: async (
    address: string,
    wallet: string,
    provider: string
  )=> {
    console.warn('Method not implemented: reconnect. Something is wrong with the wallet connection provider.');
    return false;
  },
  signTransaction: async (messages: TransactionMessage[]) : Promise<SignedTransaction> => {
    console.warn('Method not implemented: signTransaction. Something is wrong with the wallet connection provider.');
    return {
      address: '',
      signedPayload: '',
      unsignedPayload: '',
      signature: '',
      estimatedFee: 0,
    };
  },
});

export interface WalletConnectionProviderProps {
  expectedConnection?: {
    identity: string
    provider: string
    wallet: string
  },
  settings: WalletSettings
  children: ReactNode
  onDisconnect?: () => void
}

/**
 * Wallet connection provider - Exposes an instance of WalletConnection to the app.
 * @param children
 * @param reconnect
 * @constructor
 */
export const WalletConnectionProvider = ({
  children,
  onDisconnect,
  expectedConnection,
  settings,
}: WalletConnectionProviderProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectedIdentity, setConnectedIdentity] = useState<string | undefined>(undefined);
  const [allConnectedIdentities, setAllConnectedIdentities] = useState<Array<string>>([]);
  const removeAccountListenerRef = useRef<(() => void) | null>(null);

  const [connection, setConnection] = useState<WalletConnection | null>(null)

  const setAccountListener = (provider: Provider) => {
    if (provider.addListener) {
      if (removeAccountListenerRef.current) {
        removeAccountListenerRef.current();
      }

      const listener = (addresses: Array<string>) => {
        if (connectedIdentity && onDisconnect && !addresses.includes(connectedIdentity)) {
          onDisconnect()
        } else {
          setAllConnectedIdentities(addresses)
        }
      }

      provider.addListener('accountsChanged', listener);

      removeAccountListenerRef.current = () => {
        provider.removeListener!('accountsChanged', listener);
      }
    }
  }

  const connect = useCallback(async (
    providerInfo: ProviderInfoWithConnection
  ) => {
    try {
      const connection = new providerInfo.connection(providerInfo.provider, settings)
      const connectedIdentities = await connection.connect();

      setAllConnectedIdentities(connectedIdentities);
      setIsConnected(connection.isConnected);
      setConnection(connection);

      const cookieOptions = {
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100),
        secure: true,
        sameSite: 'Lax'
      } as const;

      setCookie(WALLET_COOKIE_KEY, providerInfo.connection.name, cookieOptions)
      setCookie(PROVIDER_COOKIE_KEY, providerInfo.name, cookieOptions)

      setAccountListener(providerInfo.provider)

      if (connectedIdentities.length === 1) {
        setConnectedIdentity(connection.connectedIdentity);
      }

      return connectedIdentities
    } catch (error) {
      console.error(error);
      throw error;
    }

    return []
  }, [settings]);

  const reconnect = useCallback(async (
    address: string,
    wallet: string,
    provider: string
  ) => {
    let connection: WalletConnection | undefined

    const providers = await getAvailableProviders()

    for (const providerInfo of providers) {
      if (providerInfo.name === provider && providerInfo.connection.name === wallet) {
        connection = new providerInfo.connection(providerInfo.provider, settings)

        break;
      }
    }

    if (!connection) {
      throw new Error('Failed to reconnect')
    }

    const reconnected = await connection.reconnect(address);

    setIsConnected(connection.isConnected);
    setConnectedIdentity(connection.connectedIdentity);
    setAllConnectedIdentities(connection.connectedIdentities ?? []);

    setAccountListener(connection.provider!)

    if (!reconnected) {
    //   if (onDisconnect) {
    //     onDisconnect();
    //     return false;
    //   } else {
      throw new Error('Failed to reconnect');
      // }
    } else {
      setConnection(connection)
    }

    return true;
  }, [onDisconnect, settings]);

  const getAvailableProviders = useCallback(async (): Promise<Array<ProviderInfoWithConnection>> => {
    const [sootheProviders, keplrProviders] = await Promise.all([
      PocketWalletConnection.getAvailableProviders(),
      KeplrWalletConnection.getAvailableProviders()
    ])

    return [
      ...sootheProviders.map((provider) => ({
        ...provider,
        connection: PocketWalletConnection,
      })),
      ...keplrProviders.map((provider) => ({
        ...provider,
        connection: KeplrWalletConnection,
      }))
    ]
  }, [])

  useEffect(() => {
    if (expectedConnection) {
      const { identity, provider, wallet } = expectedConnection;
      if (identity && provider && wallet) {
        (async () => {
          await reconnect(identity, wallet, provider);
        })();
      }
    }
  }, [expectedConnection?.wallet, expectedConnection?.provider, expectedConnection?.identity]);

  useEffect(() => {
    return () => {
      if (removeAccountListenerRef.current) {
        removeAccountListenerRef.current();
        removeAccountListenerRef.current = null;
      }
    }
  }, [])

  const connectIdentity = useCallback(async (address: string) => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    connection.connectIdentity(address)
    setConnectedIdentity(connection.connectedIdentity);
    setIsConnected(!!connection.connectedIdentity);
  }, [connection])

  const getChain = useCallback(async () => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    return await connection.getChain();
  }, [connection])

  const getPublicKey = useCallback(async (address: string) => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    return await connection.getPublicKey(address);
  }, [connection])

  const getBalance = useCallback(async (address: string) => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    return await connection.getBalance(address);
  }, [connection])

  const switchChain = useCallback(async (chain: string) => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    return await connection.switchChain(chain);
  }, [connection])

  const signMessage = useCallback(async (message: string, address: string) => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    return await connection.signMessage(message, address);
  }, [connection])

  const signTransaction = useCallback(async (messages: TransactionMessage[], signer?: string, memo?: SignedMemo) => {
    if (!connection) {
      throw new Error('Wallet connection not initialized')
    }

    return await connection.signTransaction(messages, signer, memo);
  }, [connection])

  const clearConnectedIdentity = useCallback(() => {
    if (connection) {
      connection.clearConnectedIdentity();
    }
    setConnectedIdentity(undefined);
  }, [connection])

  return (
    <WalletConnectionContext.Provider value={
      {
        isConnected,
        connectedIdentity,
        expectedChainId: settings.chainId,
        connectedIdentities: allConnectedIdentities,
        connect,
        reconnect,
        connectIdentity,
        getChain,
        getPublicKey,
        getBalance,
        switchChain,
        signMessage,
        getAvailableProviders,
        signTransaction,
        clearConnectedIdentity,
      }
    }>
      {children}
    </WalletConnectionContext.Provider>
  );
};

export const useWalletConnection = () => useContext(WalletConnectionContext);
