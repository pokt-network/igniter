import {ProviderInfo, TransactionMessage, WalletConnection} from "@igniter/ui/context/WalletConnection/index";
import {
  Provider, SignedTransaction,
} from "./";
import { getLogger } from "@igniter/logger";

const log = getLogger(["ui", "wallet-connection", "pocket-morse"]);

export enum PocketMethod {
  REQUEST_ACCOUNTS = "pokt_requestAccounts",
  PUBLIC_KEY = "pokt_publicKey",
  SIGN_MESSAGE = "pokt_signMessage",
  SIGN_BULK_TRANSACTION = "pokt_bulkSignTransaction",
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

export class PocketMorseWalletConnection implements WalletConnection {
  isConnected: boolean;
  connectedIdentity?: string | undefined;
  private _provider?: Provider;

  constructor() {
    this.isConnected = false;
  }

  connect = async (provider?: Provider): Promise<void> => {
    this._provider = provider ?? window.pocketNetwork;
    try {
      const [connectedIdentity] = await this.provider.send(
        PocketMethod.REQUEST_ACCOUNTS
      );

      this.isConnected = true;
      this.connectedIdentity = connectedIdentity;
    } catch (err) {
      log.error("Failed to connect to Pocket Network wallet", { error: err });
      throw err;
    }
  };

  reconnect = async (address: string): Promise<boolean> => {
    try {
      const accounts = await this.provider.send(PocketMethod.ACCOUNTS);

      if (accounts.includes(address)) {
        this.connectedIdentity = address;
        this.isConnected = true;
        return true;
      }

      return false;
    } catch (error) {
      log.warn("Failed to reconnect to Pocket Network wallet provider", { method: PocketMethod.ACCOUNTS, error });
      return false;
    }
  }

  getChain = async (): Promise<string> => {
    try {
      return await this.provider.send(
        PocketMethod.CHAIN,
      );
    } catch (err) {
      log.error("Failed to get chain from Pocket Network wallet", { error: err });
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
      log.error("Failed to get public key from Pocket Network wallet", { address, error: err });
      throw err;
    }
  }

  getBalance = async (address: string): Promise<number> => {
    try {
      const { balance } = await this.provider.send(
        PocketMethod.BALANCE,
        [{ address }]
      );
      return balance;
    } catch (err) {
      log.error("Failed to get balance from Pocket Network wallet", { address, error: err });
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
      log.error("Failed to switch chain in Pocket Network wallet", { chainId, error: err });
      throw err;
    }
  }

  signMessage = async (message: string, address: string): Promise<string> => {
    try {
      const { signature } = await this.provider.send(PocketMethod.SIGN_MESSAGE, [{ message, address }]);
      return signature;
    } catch (err) {
      log.error("Failed to sign message with Pocket Network wallet", { address, error: err });
      throw err;
    }
  }

  getAvailableProviders = async (): Promise<ProviderInfo[]> => {
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

      window.addEventListener("pocket:announceProvider", handleProviderAnnouncement);

      window.dispatchEvent(new Event("pocket:requestProvider"));

      setTimeout(() => {
        window.removeEventListener("pocket:announceProvider", handleProviderAnnouncement);
        resolve(detectedProviders);
      }, 500);
    });
  };

  signTransaction = async (transaction: TransactionMessage[]): Promise<SignedTransaction> => {
    log.warn("Method not implemented: signTransaction. Something is wrong with the wallet connection provider.");

    return {
      address: '',
      signedPayload: '',
      unsignedPayload: '',
      signature: '',
      estimatedFee: 0,
    };
  }

  get provider() {
    return this._provider ?? window.pocketNetwork;
  }
}
