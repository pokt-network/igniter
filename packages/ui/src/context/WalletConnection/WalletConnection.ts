import type { Provider } from './index'
import type { SignedMemo, SignedTransaction, TransactionMessage } from '../../lib/models'
import {
  EncodeObject,
  GeneratedType,
  Registry,
  makeAuthInfoBytes,
} from '@cosmjs/proto-signing'
import { MsgStakeSupplier, MsgUnstakeSupplier } from '@igniter/pocket/proto/pocket/supplier/tx'
import { MsgSend } from '@igniter/pocket/proto/cosmos/bank/v1beta1/tx'
import { MsgBeginRedelegate, MsgDelegate, MsgUndelegate } from '@igniter/pocket/proto/cosmos/staking/v1beta1/tx'
import { MsgWithdrawDelegatorReward } from '@igniter/pocket/proto/cosmos/distribution/v1beta1/tx'
import { Coin } from '@igniter/pocket/proto/cosmos/base/v1beta1/coin'
import { PubKey } from '@igniter/pocket/proto/cosmos/crypto/secp256k1/keys'
import { TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'

export interface WalletSettings {
  apiUrl: string;
  chainId: string;
}

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

export abstract class WalletConnection {
  protected _provider: Provider;
  protected _apiUrl: string;
  protected _chainId: string;
  protected _txRegistry: Registry;

  // Single source of truth for gas pricing shared by ALL wallets.
  protected static readonly GAS_ADJUSTMENT = 2
  protected static readonly GAS_PRICE = 0.001
  protected static readonly FEE_DENOM = 'upokt'

  constructor(provider: Provider, settings: WalletSettings) {
    this._provider = provider;
    this._apiUrl = settings.apiUrl;
    this._chainId = settings.chainId;
    this._txRegistry = new Registry([
      ["/cosmos.bank.v1beta1.MsgSend", MsgSend as unknown as GeneratedType],
      ["/pocket.supplier.MsgStakeSupplier", MsgStakeSupplier as unknown as GeneratedType],
      ["/pocket.supplier.MsgUnstakeSupplier", MsgUnstakeSupplier as unknown as GeneratedType],
      ["/cosmos.staking.v1beta1.MsgDelegate", MsgDelegate as unknown as GeneratedType],
      ["/cosmos.staking.v1beta1.MsgUndelegate", MsgUndelegate as unknown as GeneratedType],
      ["/cosmos.staking.v1beta1.MsgBeginRedelegate", MsgBeginRedelegate as unknown as GeneratedType],
      ["/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", MsgWithdrawDelegatorReward as unknown as GeneratedType],
    ]);
  }

  abstract name: string;
  abstract isConnected: boolean;
  abstract connectedIdentity?: string | undefined;
  abstract connectedIdentities?: Array<string> | undefined;
  abstract connect(): Promise<Array<string>>;
  abstract connectIdentity(address: string): void;
  abstract clearConnectedIdentity(): void;
  abstract getChain(): Promise<string>;
  abstract getPublicKey(address: string): Promise<string>;
  abstract getBalance(address: string): Promise<number>;
  abstract switchChain(chain: string): Promise<void>;
  abstract signMessage(message: string, address: string): Promise<string>;
  abstract reconnect(address: string): Promise<boolean>;
  abstract signTransaction(messages: TransactionMessage[], signer?: string, memo?: SignedMemo): Promise<SignedTransaction>;
  abstract get provider(): Provider;

  protected buildEncodeObjectFromMessage = (message: TransactionMessage): EncodeObject => {
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
      // Staking / distribution messages carry `amount` as an upokt integer string
      // (same convention as MsgSend) and are wrapped into a Coin here.
      case "/cosmos.staking.v1beta1.MsgDelegate":
        return {
          typeUrl,
          value: MsgDelegate.fromPartial({
            delegatorAddress: body.delegatorAddress,
            validatorAddress: body.validatorAddress,
            amount: Coin.fromJSON({ denom: 'upokt', amount: body.amount }),
          }),
        };
      case "/cosmos.staking.v1beta1.MsgUndelegate":
        return {
          typeUrl,
          value: MsgUndelegate.fromPartial({
            delegatorAddress: body.delegatorAddress,
            validatorAddress: body.validatorAddress,
            amount: Coin.fromJSON({ denom: 'upokt', amount: body.amount }),
          }),
        };
      case "/cosmos.staking.v1beta1.MsgBeginRedelegate":
        return {
          typeUrl,
          value: MsgBeginRedelegate.fromPartial({
            delegatorAddress: body.delegatorAddress,
            validatorSrcAddress: body.validatorSrcAddress,
            validatorDstAddress: body.validatorDstAddress,
            amount: Coin.fromJSON({ denom: 'upokt', amount: body.amount }),
          }),
        };
      case "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward":
        return {
          typeUrl,
          value: MsgWithdrawDelegatorReward.fromPartial({
            delegatorAddress: body.delegatorAddress,
            validatorAddress: body.validatorAddress,
          }),
        };
      default:
        throw new Error(`Unsupported message type: ${typeUrl}`);
    }
  }

  protected async _getSequence(address: string): Promise<{
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

  protected async _simulateGas(txRaw: TxRaw): Promise<number> {
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

  /**
   * Single source of truth for transaction gas across ALL wallets.
   * Simulates the actual messages against the chain and returns an explicit
   * gas limit with a safety margin, plus the matching fee amount (upokt).
   * Wallets MUST sign with this explicit limit rather than relying on the
   * wallet extension's own `gas:'auto'` estimation.
   */
  protected async estimateGas(
    messages: TransactionMessage[],
    signer: string,
    pubkeyFromWallet: string,
    memo?: SignedMemo,
  ): Promise<{ gasLimit: number; feeAmount: number }> {
    // detect base64 vs hex pubkey (Soothe and Keplr differ)
    const isBase64 = (s: string) => { try { return Buffer.from(s, 'base64').toString('base64') === s } catch { return false } }
    const pubkeyIsB64 = isBase64(pubkeyFromWallet)
    const anyPubkey = {
      typeUrl: '/cosmos.crypto.secp256k1.PubKey',
      value: PubKey.encode({ key: Buffer.from(pubkeyFromWallet, pubkeyIsB64 ? 'base64' : 'hex') }).finish(),
    }
    const { sequence } = await this._getSequence(signer)
    const msgs = messages.map((m) => this.buildEncodeObjectFromMessage(m))
    const memoStr = memo ? JSON.stringify(memo) : ''
    const bodyBytes = this._txRegistry.encodeTxBody({ messages: msgs, memo: memoStr })
    const authInfoBytes = makeAuthInfoBytes([{ pubkey: anyPubkey, sequence }], [], 0, undefined, signer)
    const txRawForSim = TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] })
    const gasUsed = await this._simulateGas(txRawForSim)
    const gasLimit = Math.ceil(gasUsed * WalletConnection.GAS_ADJUSTMENT)
    const feeAmount = Math.ceil(gasLimit * WalletConnection.GAS_PRICE)
    return { gasLimit, feeAmount }
  }
}
