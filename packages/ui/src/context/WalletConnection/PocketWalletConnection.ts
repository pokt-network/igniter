import type {Provider, ProviderInfo} from "./";
import { WalletConnection, WalletSettings } from './WalletConnection'
import {SignedMemo, SignedTransaction, TransactionMessage} from "../../lib/models";

export enum PocketMethod {
  REQUEST_ACCOUNTS = "pokt_requestAccounts",
  PUBLIC_KEY = "pokt_publicKey",
  SIGN_MESSAGE = "pokt_signMessage",
  SIGN_TRANSACTION = "pokt_signTransaction",
  BALANCE = "pokt_balance",
  CHAIN = "pokt_chain",
  SWITCH_CHAIN = "wallet_switchPocketChain",
  ACCOUNTS = "pokt_accounts",
}

export enum PocketNetworkTransactionTypes {
  NodeStake = "node_stake",
  NodeUnstake = "node_unstake",
  Send = "send",
}

export class PocketWalletConnection extends WalletConnection {
  name = PocketWalletConnection.name;
  isConnected: boolean;
  connectedIdentity?: string | undefined;
  connectedIdentities?: Array<string> | undefined;

  constructor(provider: Provider, settings: WalletSettings) {
    super(provider, settings)
    this.isConnected = false;
  }

  connect = async (): Promise<Array<string>> => {
    try {
      const connectedIdentities: Array<string> = await this.provider.send(
        PocketMethod.REQUEST_ACCOUNTS
      );

      if (connectedIdentities.length === 1) {
        this.connectedIdentity = connectedIdentities[0];
      }

      this.isConnected = true;
      this.connectedIdentities = connectedIdentities;

      return connectedIdentities
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  reconnect = async (address: string): Promise<boolean> => {
    try {
      const accounts = await this.provider.send(PocketMethod.ACCOUNTS);

      if (accounts.includes(address)) {
        this.connectedIdentities = accounts;
        this.connectedIdentity = address;
        this.isConnected = true;
        return true;
      }

      return false;
    } catch (error) {
      console.warn(`Something failed while interacting with the Pocket Network wallet provider. method: ${PocketMethod.ACCOUNTS}`);
      return false;
    }
  }

  connectIdentity(address: string) {
    if (this.connectedIdentities?.includes(address)) {
      this.connectedIdentity = address
    } else {
      throw new Error('Identity not connected')
    }
  }

  clearConnectedIdentity() {
    this.connectedIdentity = undefined
  }

  getChain = async (): Promise<string> => {
    try {
      return await this.provider.send(
        PocketMethod.CHAIN,
      ).then((res) => res.chain);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  getPublicKey = async (address: string): Promise<string> => {
    try {
      const { publicKey } = await this.provider.send(
        PocketMethod.PUBLIC_KEY,
        [{ address }]
      );
      return publicKey;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  getBalance = async (address: string): Promise<number> => {
    try {
      const response = await fetch(
        `${this._apiUrl}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=upokt`,
      )
      const data = await response.json()
      return ((data.balance?.amount || 0) / 1e6)
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  switchChain = async (chainId: string): Promise<void> => {
    try {
      await this.provider.send(
        PocketMethod.SWITCH_CHAIN,
        [{ chainId }],
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  signMessage = async (message: string, address: string): Promise<string> => {
    try {
      const { signature } = await this.provider.send(PocketMethod.SIGN_MESSAGE, [{ message, address }]);
      return signature;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  static async getAvailableProviders(): Promise<ProviderInfo[]> {
    return new Promise<ProviderInfo[]>((resolve) => {
      const detectedProviders: ProviderInfo[] = [];

      const handleProviderAnnouncement = (event: Event) => {
        const { detail } = event as CustomEvent<any>;
        if (detail) {
          detectedProviders.push({
            ...detail.info,
            provider: detail.provider,
          });
        }
      };

      window.addEventListener("pocket_shannon:announceProvider", handleProviderAnnouncement);

      window.dispatchEvent(new Event("pocket_shannon:requestProvider"));

      setTimeout(() => {
        window.removeEventListener("pocket_shannon:announceProvider", handleProviderAnnouncement);
        resolve(detectedProviders);
      }, 500);
    });
  };

  signTransaction = async (messages: TransactionMessage[], signer?: string, memo?: SignedMemo): Promise<SignedTransaction> => {
    if (signer && !this.connectedIdentities?.includes(signer)) {
      throw new Error(`Signer ${signer} is not connected to the wallet`);
    }

    const addr = signer || this.connectedIdentity || "";

    // Compute gas ourselves via the shared estimator and hand Soothe an EXPLICIT
    // gas limit. The installed Soothe build does not apply gasAdjustment to its own
    // `gas:'auto'` estimate, which underfunded batch stakes (code 11 out of gas).
    const pubkey = await this.getPublicKey(addr);
    const { gasLimit } = await this.estimateGas(messages, addr, pubkey, memo);

    const transaction = {
      address: addr,
      gas: gasLimit,        // explicit number — bypasses Soothe's internal 'auto' estimation
      gasAdjustment: 1,     // we already applied the 2x margin in estimateGas; do not double it
      messages,
    };

    if (memo) {
      Object.assign(transaction, {
        memo: JSON.stringify(memo),
      });
    }

    try {
      const { signature, transactionHex, rawTx, fee  } = await this.provider.send(PocketMethod.SIGN_TRANSACTION, [transaction]);
      return {
        address: signer || this.connectedIdentity || "",
        signedPayload: transactionHex,
        unsignedPayload: rawTx,
        signature,
        estimatedFee: fee,
      };
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  get provider() {
    if (!this._provider) {
      throw new Error('Provider not found');
    }

    return this._provider;
  }
}
