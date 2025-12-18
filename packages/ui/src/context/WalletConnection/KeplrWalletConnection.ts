import type { ProviderInfo, Provider} from "./index";
import type { SignedMemo, SignedTransaction, TransactionMessage } from "../../lib/models";
import {
  decodePubkey,
  EncodeObject,
  GeneratedType,
  OfflineSigner,
  Registry,
  makeAuthInfoBytes,
  makeSignDoc
} from '@cosmjs/proto-signing'
import {MsgStakeSupplier, MsgUnstakeSupplier} from "@igniter/pocket/proto/pocket/supplier/tx";
import { AuthInfo, TxBody, TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import {PubKey} from "@igniter/pocket/proto/cosmos/crypto/secp256k1/keys";
import {MsgSend} from "@igniter/pocket/proto/cosmos/bank/v1beta1/tx";
import {Coin} from "@igniter/pocket/proto/cosmos/base/v1beta1/coin";
import { WalletConnection, WalletSettings } from './WalletConnection'

export type AccountSequenceRawBody = {
  account: {
    "@type": string
    address: string
    pub_key: {
      "@type": string
      key: string
    }
    account_number: string
    sequence: string
  }
}

export class KeplrWalletConnection extends WalletConnection {
  name = KeplrWalletConnection.name;
  isConnected = false;
  connectedIdentity?: string;
  connectedIdentities?: string[];
  private _keplr?: any;
  private _offlineSigner?: OfflineSigner;
  private _registry?: Registry;

  constructor(provider: Provider, settings: WalletSettings) {
    super(provider, settings);
    this._registry = new Registry([
      ["/cosmos.bank.v1beta1.MsgSend", MsgSend as unknown as GeneratedType],
      ["/pocket.supplier.MsgStakeSupplier", MsgStakeSupplier as unknown as GeneratedType],
      ["/pocket.supplier.MsgUnstakeSupplier", MsgUnstakeSupplier as unknown as GeneratedType],
    ]);
  }

  private get keplr() {
    const k = this._keplr ?? (window as any).keplr;
    if (!k) throw new Error("Keplr provider not found. Please install/enable the Keplr extension.");
    this._keplr = k;
    return k;
  }

  private async ensureEnabled(chainId = this._chainId): Promise<void> {
    if (!chainId) throw new Error("No chainId configured.");
    try {
      await this.keplr.enable(chainId);
    } catch (e) {
      throw e;
    }
  }

  private async getSigner() {
    if (!this._chainId) throw new Error("No chain configured.");
    if (this._offlineSigner) return this._offlineSigner;
    await this.ensureEnabled(this._chainId);
    this._offlineSigner = await this.keplr.getOfflineSignerAuto(this._chainId);
    return this._offlineSigner;
  }

  connect = async (): Promise<string[]> => {
    await this.ensureEnabled();
    const key = await this.keplr.getKey(this._chainId);
    this.connectedIdentity = key.bech32Address;
    this.connectedIdentities = [key.bech32Address];
    this.isConnected = true;
    return this.connectedIdentities;
  };

  reconnect = async (address: string): Promise<boolean> => {
    try {
      await this.ensureEnabled();
      const key = await this.keplr.getKey(this._chainId);
      const ok = key.bech32Address === address;
      if (ok) {
        this.connectedIdentity = address;
        this.connectedIdentities = [address];
        this.isConnected = true;
      }
      return ok;
    } catch {
      return false;
    }
  };

  connectIdentity(address: string) {
    if (this.connectedIdentities?.includes(address)) {
      this.connectedIdentity = address;
    } else {
      throw new Error("Identity not connected");
    }
  }

  clearConnectedIdentity() {
    this.connectedIdentity = undefined;
  }

  getChain = async (): Promise<string> => {
    if (!this._chainId) throw new Error("No chain configured.");
    return this._chainId;
  };

  getPublicKey = async (address: string): Promise<string> => {
    await this.ensureEnabled();
    const key = await this.keplr.getKey(this._chainId);
    if (key.bech32Address !== address) {
      throw new Error("Requested address is not the active Keplr account for this chain.");
    }
    return Buffer.from(key.pubKey).toString("base64");
  };

  getBalance = async (address: string): Promise<number> => {
    const response = await fetch(
      `${this._apiUrl}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=upokt`,
    )

    const data = await response.json()

    return ((data.balance.amount || 0) / 1e6)
  };

  switchChain = async (chainId: string): Promise<void> => {
    try {
      await this.keplr.enable(chainId);
    } catch (e) {
      throw e;
    }

    const key = await this.keplr.getKey(chainId);
    this.connectedIdentity = key.bech32Address;
    this.connectedIdentities = [key.bech32Address];
  };

  signMessage = async (message: string, address: string): Promise<string> => {
    await this.ensureEnabled();
    // ADR-36 compliant
    const sig = await this.keplr.signArbitrary(this._chainId, address, message);
    // Return raw signature base64 (align with your UI’s expectations)
    return sig.signature;
  };

  buildEncodeObjectFromMessage = (message: TransactionMessage): EncodeObject => {
    const { typeUrl, body } = message;
    switch (typeUrl) {
      case "/cosmos.bank.v1beta1.MsgSend":
        return {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            ...MsgSend.fromJSON(body),
            amount: [
              Coin.fromJSON({
                amount: body.amount,
                denom: 'upokt',
              })
            ],
          }
        };
      case "/pocket.supplier.MsgStakeSupplier":
        return {
          typeUrl: "/pocket.supplier.MsgStakeSupplier",
          value: {
            ...MsgStakeSupplier.fromJSON(body),
            services: [],
            // TODO: Update both the supplier and middleman to align to the correct attribute name for this message.
            stake: Coin.fromJSON({
              denom: "upokt",
              amount: body.stakeAmount,
            }),
          }
        };
      case "/pocket.supplier.MsgUnstakeSupplier":
        return {
          typeUrl: "/pocket.supplier.MsgUnstakeSupplier",
          value: MsgUnstakeSupplier.fromJSON(body)
        };
      default:
        throw new Error(`Unsupported message type: ${typeUrl}`);
    }
  }

  /**
   * messages: you’ll pass pre-built Cosmos messages (typeUrl + value) elsewhere in your app.
   * fee: we default to "auto" behavior by estimating via signAndBroadcast's gasPrice if set on client; you can also craft StdFee.
   */
  signTransaction = async (
    messages: Array<TransactionMessage>,
    signer?: string,
    memoObj?: SignedMemo
  ): Promise<SignedTransaction> => {
    const address = signer ?? this.connectedIdentity ?? "";
    if (!address) throw new Error("No signer address is connected.");

    await this.ensureEnabled(this._chainId);


    const signerKeplr = await this.getSigner();

    const [account] = await signerKeplr!.getAccounts();
    if (!account || account.address !== address) {
      throw new Error("Active Keplr account does not match requested signer.");
    }

    const msgs = messages.map(this.buildEncodeObjectFromMessage);

    const { accountNumber, sequence } = await this._getSequence(address);

    const memo = memoObj ? JSON.stringify(memoObj) : "";
    const bodyBytes = this._registry!.encodeTxBody({ messages: msgs, memo });

    const anyPubkey = {
      typeUrl: "/cosmos.crypto.secp256k1.PubKey",
      value: PubKey.encode({ key: account.pubkey }).finish(),
    };

    const authInfoBytesForSim = makeAuthInfoBytes(
      [{ pubkey: anyPubkey, sequence }],
      [],
      0,
      undefined,
      address,
    )

    const txRawForSim = TxRaw.fromPartial({
      bodyBytes,
      authInfoBytes: authInfoBytesForSim,
      signatures: [new Uint8Array()],
    });

    const gasUsed = await this._simulateGas(txRawForSim);

    const gasAdjustment = 2;
    const gasPriceNum = 0.001;
    const feeDenom = "upokt";

    const gas = Math.ceil(gasUsed * gasAdjustment);
    const feeAmount = Math.ceil(gas * gasPriceNum);

    const authInfoBytes = makeAuthInfoBytes(
      [{ pubkey: anyPubkey, sequence }],
      [{ denom: feeDenom, amount: String(feeAmount) }],
      gas,
      undefined,
      address,
    );

    const signDoc = makeSignDoc(bodyBytes, authInfoBytes, this._chainId, accountNumber);

    const { signed, signature } = await this.keplr.signDirect(this._chainId, address, signDoc);

    const txRaw: TxRaw = TxRaw.fromPartial({
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      signatures: [Buffer.from(signature.signature, "base64")],
    });

    const txBytes = TxRaw.encode(txRaw).finish();
    const signedHex = Buffer.from(txBytes).toString("hex");
    const signatureHex = Buffer.from(signature.signature, "base64").toString("hex");

    return {
      address,
      estimatedFee: feeAmount,
      signature: signatureHex,
      signedPayload: signedHex,
      unsignedPayload: this._getRawTxJson(txRaw),
    };
  };

  private async _simulateGas(txRaw: TxRaw): Promise<number> {
    if (!this._apiUrl) {
      throw new Error('API URL not configured. Please set this._apiUrl to a Cosmos REST endpoint.');
    }

    const txBytes = TxRaw.encode(txRaw).finish();
    const txBase64 = Buffer.from(txBytes).toString('base64');

    const res = await fetch(`${this._apiUrl}/cosmos/tx/v1beta1/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_bytes: txBase64 }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gas simulation failed (${res.status}): ${text || 'no body'}`);
    }

    const data: any = await res.json();
    const gasInfo = data?.gas_info;
    const gasUsedStr = gasInfo?.gas_used ?? gasInfo?.gas_wanted;

    const gas = Number(gasUsedStr);
    if (!Number.isFinite(gas) || gas <= 0) {
      throw new Error(`Invalid simulation response: ${JSON.stringify(data)}`);
    }

    return gas;
  };

  private async _getSequence(address: string): Promise<{
    accountNumber: number,
    sequence: number,
  }> {
    if (!this._apiUrl) {
      throw new Error('API URL not configured. Please set this._apiUrl to a Cosmos REST endpoint.');
    }

    const res = await fetch(`${this._apiUrl}/cosmos/auth/v1beta1/accounts/${address}`);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Fetch account sequence failed (${res.status}): ${text || 'no body'}`);
    }

    const data: AccountSequenceRawBody = await res.json();

    return {
      accountNumber: Number(data.account.account_number),
      sequence: Number(data.account.sequence)
    }
  };

  private _getRawTxJson(txRaw: TxRaw): string {
    const decodedBody = TxBody.decode(txRaw.bodyBytes)

    const decodedAuthInfo = AuthInfo.decode(txRaw.authInfoBytes)

    for (let i = 0; i < decodedAuthInfo.signerInfos.length; i++) {
      const signerInfo = decodedAuthInfo.signerInfos[i]

      if (signerInfo && signerInfo.publicKey) {
        const decodedPubKey = decodePubkey(signerInfo.publicKey)

        if (decodedPubKey && decodedAuthInfo.signerInfos[i]) {
          decodedAuthInfo.signerInfos[i]!.publicKey = {
            typeUrl: decodedPubKey.type,
            value: decodedPubKey.value,
          }
        }
      }
    }

    return JSON.stringify({
      body: {
        ...decodedBody,
        messages: decodedBody.messages.map((message) => ({
          typeUrl: message.typeUrl,
          value: this._decodeMessage(message),
        })),
      },
      auth_info: decodedAuthInfo,
      signatures: txRaw.signatures.map(signature => Buffer.from(signature).toString('base64')),
    })
  }

  private _decodeMessage(message: { typeUrl: string, value: Uint8Array }): object {
    switch (message.typeUrl) {
      case '/cosmos.bank.v1beta1.MsgSend':
        return MsgSend.decode(message.value)
      case '/pocket.supplier.MsgStakeSupplier':
        return MsgStakeSupplier.decode(message.value)
      case '/pocket.supplier.MsgUnstakeSupplier':
        return MsgUnstakeSupplier.decode(message.value)
      default:
        throw new Error(`Unknown message type: ${message.typeUrl}`)
    }
  }

  static async getAvailableProviders(): Promise<ProviderInfo[]> {
    const providers: ProviderInfo[] = [];
    const w = window as any;
    if (w.keplr) {
      providers.push({
        name: "Keplr",
        ...w.keplr?.ethereum?.eip6963ProviderInfo,
        provider: w.keplr,
      });
    }
    // if (w.owallet) {
    //   providers.push({ name: "OWallet (Keplr-compatible)", provider: w.owallet });
    // }
    // if (w.cosmostation) {
    //   providers.push({ name: "Cosmostation (Keplr API)", provider: w.cosmostation });
    // }
    // // Some wallets (Hana) also implement Keplr API surface
    // if (w.hanaWallet) {
    //   providers.push({ name: "Hana (Keplr API)", provider: w.hanaWallet });
    // }
    return providers;
  };

  get provider() {
    return this._provider;
  }
}
