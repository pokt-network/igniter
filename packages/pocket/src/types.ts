import { Supplier } from '@pocket/proto/generated/pocket/shared/supplier'
import {MsgStakeSupplier, MsgUnstakeSupplier} from "@pocket/proto/generated/pocket/supplier/tx";
import {Coin} from "@pocket/proto/generated/cosmos/base/v1beta1/coin";
import {RPCType} from "@pocket/proto/generated/pocket/shared/service";
import { MsgSend } from '@pocket/proto/generated/cosmos/bank/v1beta1/tx';

export {
  SupplierServiceConfig,
  SupplierEndpoint,
  ServiceRevenueShare,
  ConfigOption,
  RPCType,
} from '@pocket/proto/generated/pocket/shared/service'

export {MsgStakeSupplier} from "@pocket/proto/generated/pocket/supplier/tx";

export { Supplier, ServiceConfigUpdate } from '@pocket/proto/generated/pocket/shared/supplier';

export interface PocketExtension {
  readonly bank: {
    /**
     * Retrieves the balance of a specific address for a given denomination.
     *
     * @param {string} address - The address of the account to query the balance for.
     * @param {string} denom - The denomination of the currency to check the balance of.
     * @returns {Promise<Coin>} A promise that resolves to a `Coin` object containing the amount and denom of the balance.
     */
    readonly balance: (address: string, denom?: string) => Promise<Coin>;
    /**
     * Represents a method to retrieve the spendable balance of a specified denomination for a given address.
     *
     * @readonly
     * @function
     * @param {string} address - The blockchain address for which the spendable balance is to be queried.
     * @param {string} denom - The denomination of the currency to check the spendable balance for.
     * @returns {Promise<Coin>} A promise that resolves to a Coin object containing the spendable balance information.
     */
    readonly spendableBalanceByDenom: (address: string, denom?: string) => Promise<Coin>;
    /**
     * Retrieves all balance information associated with a given address.
     *
     * @param {string} address - The address for which balance information is required.
     * @returns {Promise<Coin[]>} A promise that resolves to an array of Coin objects representing the balances.
     */
    readonly allBalances: (address: string) => Promise<Coin[]>;
  }
  readonly supplier: {
    readonly getSupplier: (address: string) => Promise<Supplier | null>;
  }
}

export interface SendTransactionResult {
  transactionHash: string;
  success: boolean;
  code?: number;
  message?: string;
  codespace?: string;
  isTimeout?: boolean;
  /**
   * True when the tx was definitively rejected by CheckTx / BroadcastTxError and can NEVER land
   * on-chain (hard reject). False/undefined for dedup-success, TimeoutError, or any other case
   * where the tx may still land. Callers must treat undefined as non-rejected.
   */
  rejected?: boolean;
  /** Chain head sampled immediately before signing — the lowest possible inclusion height anchor. */
  signedAtHeight?: number;
  /** timeoutHeight embedded in the signed tx; inclusion in any block > this height is impossible. */
  timeoutHeight?: number;
  /** base64-encoded signed TxRaw bytes — persisted so re-broadcast replays identical bytes. */
  signedPayload?: string;
  /** unordered tx timeout_timestamp (chain-time validity bound). */
  timeoutTimestamp?: Date;
}

export interface TransactionResult {
  hash: string;
  height: number;
  index?: number;
  gasUsed?: bigint;
  gasWanted?: bigint;
  success: boolean;
  code: number;
  /** Chain error text (ABCI log) for failed txs; empty/undefined on success. */
  rawLog?: string;
}

/**
 * The StakeSupplierParams interface extends the MsgStakeSupplier interface and represents the
 * parameters required when staking a new supplier. It is extended with the private key of
 * the signer performing the staking transaction.
 *
 *
 * Properties:
 * - `signerPrivateKey`: A string representing the private key of the signer. This key is
 *   used for authorizing the staking operation securely.
 *
 * Inherits:
 * - Extends `MsgStakeSupplier`, which includes additional properties required for staking a supplier.
 */
export type StakeSupplierParams = {
  signerPrivateKey: string;
} & MsgStakeSupplier;


export type UnstakeSupplierParams = {
  signerPrivateKey: string;
} & MsgUnstakeSupplier;

export type SendFundsParams = {
  signerPrivateKey: string;
} & MsgSend;

export type ValidRPCTypes = keyof typeof RPCType | "0" | "1" | "2" | "3" | "4" | "5";