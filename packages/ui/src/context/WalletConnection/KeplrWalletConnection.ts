import type { ProviderInfo, Provider} from "./index";
import type { SignedMemo, SignedTransaction, TransactionMessage } from "../../lib/models";
import {
  decodePubkey,
  OfflineSigner,
  makeAuthInfoBytes,
  makeSignDoc
} from '@cosmjs/proto-signing'
import {MsgStakeSupplier, MsgUnstakeSupplier} from "@igniter/pocket/proto/pocket/supplier/tx";
import { AuthInfo, TxBody, TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import {PubKey} from "@igniter/pocket/proto/cosmos/crypto/secp256k1/keys";
import {MsgSend} from "@igniter/pocket/proto/cosmos/bank/v1beta1/tx";
import { WalletConnection, WalletSettings } from './WalletConnection'
import { TX_EXPIRATION_BLOCKS } from '@igniter/tx-verify'

export class KeplrWalletConnection extends WalletConnection {
  name = KeplrWalletConnection.name;
  isConnected = false;
  connectedIdentity?: string;
  connectedIdentities?: string[];
  private _keplr?: any;
  private _offlineSigner?: OfflineSigner;

  constructor(provider: Provider, settings: WalletSettings) {
    super(provider, settings);
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
    // Embed timeoutHeight so the verifier can anchor failure verdicts without waiting
    // for the full sequence-consumed check. PocketWalletConnection hands signing to
    // the external wallet and cannot control this field — those txs rely on the
    // sequence rule in checkTxValidityEvidence (see: parseSignerAndSequence activity).
    const currentHeight = await this._getBlockHeight();
    const bodyBytes = this._txRegistry.encodeTxBody({ messages: msgs, memo, timeoutHeight: BigInt(currentHeight + TX_EXPIRATION_BLOCKS) });

    const anyPubkey = {
      typeUrl: "/cosmos.crypto.secp256k1.PubKey",
      value: PubKey.encode({ key: account.pubkey }).finish(),
    };

    const pubkeyB64 = Buffer.from(account.pubkey).toString('base64');
    const { gasLimit: gas, feeAmount } = await this.estimateGas(messages, address, pubkeyB64, memoObj);

    const authInfoBytes = makeAuthInfoBytes(
      [{ pubkey: anyPubkey, sequence }],
      [{ denom: WalletConnection.FEE_DENOM, amount: String(feeAmount) }],
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

  /**
   * Fetches the current chain head height via the Cosmos REST API.
   * Used to embed timeoutHeight at signing time so the verifier can anchor failure verdicts.
   */
  private async _getBlockHeight(): Promise<number> {
    if (!this._apiUrl) {
      throw new Error('API URL not configured.');
    }
    const res = await fetch(`${this._apiUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Fetch block height failed (${res.status}): ${text || 'no body'}`);
    }
    const data = await res.json();
    return Number(data.block.header.height);
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
