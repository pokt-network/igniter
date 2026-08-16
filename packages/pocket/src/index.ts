import {
  BroadcastTxError,
  calculateFee,
  GasPrice,
  ProtobufRpcClient,
  QueryClient,
  SigningStargateClient,
  StargateClient, TimeoutError,
} from '@cosmjs/stargate'
import {DirectSecp256k1Wallet, encodePubkey, GeneratedType, makeAuthInfoBytes, makeSignDoc, Registry} from '@cosmjs/proto-signing'
import { fromBase64 } from '@cosmjs/encoding'
import { TxBody, TxRaw } from '@pocket/proto/generated/cosmos/tx/v1beta1/tx'
import {
  Comet38Client,
  connectComet,
} from '@cosmjs/tendermint-rpc'
import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import {
  QueryAllBalancesRequest,
  QueryBalanceRequest,
  QueryClientImpl as BankQueryClientImpl,
  QuerySpendableBalanceByDenomRequest,
} from '@pocket/proto/generated/cosmos/bank/v1beta1/query'
import { Buffer } from 'buffer'
import {
  QueryClientImpl as SupplierQueryClientImpl,
  QueryGetSupplierRequest,
} from '@pocket/proto/generated/pocket/supplier/query'
import {
  PocketExtension,
  SendTransactionResult,
  TransactionResult,
} from '@pocket/types'
import { Coin } from '@pocket/proto/generated/cosmos/base/v1beta1/coin'
import { Supplier } from '@pocket/proto/generated/pocket/shared/supplier'
import {StakeSupplierParams, UnstakeSupplierParams, SendFundsParams} from "@pocket/types";
import {MsgStakeSupplier, MsgUnstakeSupplier} from "@pocket/proto/generated/pocket/supplier/tx";
import {MsgSend} from "@pocket/proto/generated/cosmos/bank/v1beta1/tx";
import {isValidPrivateKey} from "@pocket/utils";
import {getLogger, Logger} from '@igniter/logger'
import type { VerifyOutcome, SupplierEffect } from '@igniter/tx-verify'
import { TX_EXPIRATION_BLOCKS } from '@igniter/tx-verify'

export * from './types'
export * from './constants';
export * from '@igniter/tx-verify';
export { rPCTypeFromJSON } from './proto/generated/pocket/shared/service';

/**
 * Parses the expected sequence number from a Cosmos SDK account sequence mismatch error.
 * Error format: "account sequence mismatch, expected X, got Y: incorrect account sequence"
 * @returns The expected sequence number, or null if the error doesn't match.
 */
export function parseExpectedSequence(errorMessage: string): number | null {
  const match = errorMessage.match(/account sequence mismatch, expected (\d+), got (\d+)/)
  if (!match) return null
  return parseInt(match[1]!, 10)
}

/**
 * Returns true if the error message indicates a Cosmos SDK account sequence mismatch.
 */
export function isSequenceMismatchError(errorMessage: string): boolean {
  return errorMessage.includes('account sequence mismatch')
}

/**
 * Maps `items` through `fn` with at most `limit` calls in flight at once, preserving
 * input order in the returned array. Used to bound the Tier-3 block scan's parallel
 * `comet.block()` fan-out: firing all ~30 heights at once (and up to MAX_CONCURRENT
 * ExecuteTransactions doing the same) could burst hundreds of concurrent RPCs at a
 * single node and trip its rate limits. A small pool keeps most of the latency win
 * of parallelism without the unbounded burst (issue #304).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  }
  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/** Max concurrent `comet.block()` fetches per Tier-3 block scan (issue #304). */
const BLOCK_SCAN_CONCURRENCY = 8

/**
 * Encodes a raw secp256k1 public key as an amino pubkey object.
 * Inlined to avoid a direct dependency on @cosmjs/amino (available only transitively).
 */
function encodeSecp256k1Pubkey(pubkey: Uint8Array): { type: string; value: string } {
  return { type: 'tendermint/PubKeySecp256k1', value: Buffer.from(pubkey).toString('base64') }
}

/** Unordered-tx validity window. 9 min < cosmos-sdk DefaultMaxTimeoutDuration (10 min). */
const UNORDERED_TIMEOUT_MS = 9 * 60 * 1000

/**
 * Returns true if the error is a cosmos-sdk unordered-tx duplicate rejection.
 *
 * FLAGGED ASSUMPTION: The exact error shape for a cosmos-sdk v0.53+ unordered
 * duplicate (same (timeoutTimestamp.UnixNano(), sender)) is not verifiable from
 * the JS surface alone. Based on cosmos-sdk x/auth/ante/unordered.go the error is
 * registered as ErrUnorderedTxExist and is returned as a BroadcastTxError with
 * code 19 (codespace "sdk") and log containing "tx already exists in cache" (the
 * errorsmod.Wrapf message from the unordered handler). This is a best-effort match;
 * if pocket-network's fork uses a different code, update the code number here.
 */
/**
 * The transaction hash for a signed payload, derived without asking the chain: sha256 of the
 * exact bytes broadcast, uppercase hex. Identical to what CometBFT returns from
 * `broadcast_tx_sync` and to the derivation `matchTxInBlock` uses when scanning a block, so a
 * hash produced here is findable on-chain later.
 *
 * @param signedPayloadHex hex-encoded signed TxRaw bytes (middleman's storage encoding)
 * @throws if the payload is not valid hex — `Buffer.from(x, 'hex')` truncates silently at the
 *   first invalid character, and an empty result would yield sha256('') for every bad payload,
 *   writing one constant hash across unrelated transactions.
 */
export function deriveTxHash(signedPayloadHex: string): string {
  if (!/^[0-9a-fA-F]*$/.test(signedPayloadHex) || signedPayloadHex.length === 0 || signedPayloadHex.length % 2 !== 0) {
    throw new Error('deriveTxHash: signed payload is not valid hex')
  }
  return toHex(sha256(Uint8Array.from(Buffer.from(signedPayloadHex, 'hex')))).toUpperCase()
}

/**
 * CheckTx codes that do NOT prove the transaction can never land, even though cosmjs raises the
 * same BroadcastTxError for them as for a real rejection:
 *   32 (ErrWrongSequence)  — the sequence is already consumed (the tx ALREADY LANDED) or a
 *                            predecessor is still in the mempool (this tx lands after it).
 *   20 (ErrMempoolIsFull)  — the node had no room; the bytes are still valid and may be accepted
 *                            on a later attempt or by another node.
 * Treating either as terminal is how a landed transaction gets recorded as failed — the exact
 * defect #339 is about. Route them to the verifier instead and let the chain answer.
 */
const INDETERMINATE_CHECKTX_CODES = new Set([20, 32])

function isUnorderedDedupRejection(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const err = e as Error & { code?: number; codespace?: string; rawLog?: string }
  const msg = String(err?.message ?? err?.rawLog ?? '').toLowerCase()
  if (err.codespace === 'sdk' && msg.includes('failed to add unordered nonce')) return true
  if (msg.includes('tx already in mempool') || msg.includes('already exists in cache')) return true
  return false
}

/**
 * Creates a Protobuf-based RPC client for querying a blockchain using a QueryClient.
 *
 * This client sends Protobuf-encoded requests to a specified service and method
 * and returns the Protobuf-encoded response received from the blockchain. It uses
 * the provided QueryClient for ABCI queries, enabling interaction with the
 * blockchain's query interface.
 *
 * @param {QueryClient} base - The base instance of QueryClient used to execute ABCI queries.
 * @param {number} [height] - Optional block height for which the queries should be executed.
 *                            If not provided, the latest block height is used.
 *
 * @returns {ProtobufRpcClient} A client capable of making Protobuf-encoded RPC requests.
 */
const createProtobufRpcClient = function (base: QueryClient, height?: number): ProtobufRpcClient {
  return {
    request: async (service: string, method: string, data: Uint8Array): Promise<Uint8Array> => {
      const path = `/${service}/${method}`
      const response = await base.queryAbci(path, data, height)
      return response.value
    },
  }
}

/**
 * Creates a new QueryClient with Pocket extension methods.
 * @param height Optional block height for which the queries should be executed.
 */
const setupPocketExtension = (height?: number) => (base: QueryClient): PocketExtension => {
  const rpc = createProtobufRpcClient(base, height)

  // Use this service to get easy typed access to query methods
  // This cannot be used for proof verification
  const bankQueryService = new BankQueryClientImpl(rpc)
  const supplierQueryService = new SupplierQueryClientImpl(rpc)

  return {
    bank: {
      balance: async (address: string, denom: string = 'upokt') => {
        let { balance } = await bankQueryService.Balance(
          QueryBalanceRequest.fromPartial({ address, denom }),
        )

        if (!balance) balance = Coin.fromPartial({ denom, amount: '0' })

        return balance
      },
      spendableBalanceByDenom: async (address: string, denom: string = 'upokt') => {
        let { balance } = await bankQueryService.SpendableBalanceByDenom(
          QuerySpendableBalanceByDenomRequest.fromPartial({ address, denom }),
        )

        if (!balance) balance = Coin.fromPartial({ denom, amount: '0' })

        return balance
      },
      allBalances: async (address: string) => {
        const { balances } = await bankQueryService.AllBalances(
          QueryAllBalancesRequest.fromPartial({ address: address }),
        )
        return balances
      },
    },
    supplier: {
      getSupplier: async (operatorAddress: string) => {
        const { supplier } = await supplierQueryService.Supplier(
          QueryGetSupplierRequest.fromPartial({ operatorAddress }),
        )
        return supplier || null
      },
    },
  }
}

/**
 * Returns a QueryClient with PocketExtension initialized using the provided Comet38Client.
 *
 * @param {Comet38Client} cometClient - The client to be used for creating the QueryClient.
 * @param {number} [height] - Optional height parameter to set up the PocketExtension.
 * @return {QueryClient & PocketExtension} The QueryClient with the added PocketExtension.
 */
export default function getQueryClient(cometClient: Comet38Client, height?: number): QueryClient & PocketExtension {
  return QueryClient.withExtensions(
    cometClient,
    setupPocketExtension(height),
  )
}

/**
 * A class that provides a wrapper around the StargateClient and Comet38Client for interacting with the blockchain.
 * It provides methods to connect, disconnect, get the balance, get the height, send a transaction, and retrieve transaction details.
 * It also provides methods to get the supplier address for a given address.
 */
export class PocketBlockchain {
  protected readonly rpcUrl: string
  protected readonly denom: string
  protected readonly gasPrice?: GasPrice
  protected readonly apiUrl?: string
  protected stargateClient: StargateClient | undefined
  protected cometClient: Comet38Client | undefined
  protected logger: Logger;

  /**
   * @param rpcUrl bech32 Cosmos SDK RPC endpoint, e.g. https://rpc.cosmos.network
   * @param denom  staking token denom, e.g. "upokt"
   * @param gasPrice
   */
  private constructor(rpcUrl: string, denom: string = 'upokt', gasPrice = 0.001, apiUrl?: string) {
    this.rpcUrl = rpcUrl
    this.denom = denom
    this.gasPrice = GasPrice.fromString(`${gasPrice}${denom}`)
    this.apiUrl = apiUrl
    this.logger = getLogger(['pocket', 'blockchain'])
  }

  /**
   * Sets up a new instance of the Blockchain class and establishes a connection.
   *
   * @param {string} rpcUrl - The RPC URL for the blockchain connection.
   * @param {string} [denom='upokt'] - The denomination to be used, defaults to 'upokt'.
   * @param gasPrice
   * @return {Promise<Blockchain>} A promise that resolves to an instance of the Blockchain class.
   */
  static async setup(rpcUrl: string, denom: string = 'upokt', gasPrice = 0.001, apiUrl?: string) {
    const blockchain = new PocketBlockchain(rpcUrl, denom, gasPrice, apiUrl)
    await blockchain.connect()
    return blockchain
  }

  /**
   * Connects to the blockchain and initializes the client.
   * NOTE: This method should be called before using any other methods, otherwise they will do it.
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    try {
      if (!this.cometClient) this.cometClient = await connectComet(this.rpcUrl) as Comet38Client
      if (!this.stargateClient) this.stargateClient = await StargateClient.create(this.cometClient, {})
    } catch (error) {
      this.logger.error('Failed to connect to the blockchain', { error })
      throw new Error('Failed to connect to the blockchain.')
    }
  }

  /**
   * Returns the configured StargateClient instance.
   * @throws Error if the client is not initialized
   */
  async getStargateClient(): Promise<StargateClient> {
    if (!this.stargateClient) {
      await this.connect()
    }
    return this.stargateClient!
  }

  /**
   * Returns the configured Comet38Client instance.
   * @throws Error if the client is not initialized
   */
  async getCometClient(): Promise<Comet38Client> {
    if (!this.cometClient) {
      await this.connect()
    }

    return this.cometClient!
  }

  /** Disconnects StartGate client. */
  disconnect(): void {
    if (this.stargateClient) {
      this.stargateClient.disconnect()
      this.stargateClient = undefined
    }
    if (this.cometClient) {
      this.cometClient.disconnect()
      this.cometClient = undefined
    }
  }

  /** Returns the numeric token balance for `address` in the configured `denom`. */
  async getBalance(address: string, height?: number): Promise<number> {
    const client = await this.getCometClient()
    const queryClient = getQueryClient(client, height)

    const coin = await queryClient.bank.balance(address, this.denom)

    return parseInt(coin.amount, 10)
  }

  /** Returns the latest block height from the chain. */
  async getHeight(): Promise<number> {
    const client = await this.getStargateClient()

    try {
      return await client.getHeight()
    } catch (err) {
      this.logger.error('Unexpected blockchain error', { error: err })
      throw new Error('Unable to fetch the height from the blockchain.')
    }
  }

  /**
   * Broadcasts a signed transaction (hex-encoded) to the network.
   *
   * The returned hash is derived LOCALLY (sha256 of the exact bytes broadcast, the same
   * derivation `matchTxInBlock` uses during a block scan), so the caller holds it even when
   * the node's reply never arrives. That matters because a transport failure is not evidence
   * of anything: the node may have accepted the tx into its mempool before the socket died,
   * in which case it still lands on-chain. Only `rejected` says the tx can never land.
   *
   * Mirrors `broadcastSupplierTx`'s ladder, on `broadcastTxSync` (which THROWS
   * BroadcastTxError on a non-zero CheckTx code) instead of `broadcastTx`.
   *
   * @param payload hex string of the signed tx bytes
   * @returns transactionHash (locally derived) plus the outcome discriminator `rejected`
   */
  async sendTransaction(payload: string): Promise<SendTransactionResult> {
    const localHash = deriveTxHash(payload)
    const txBytes = Uint8Array.from(Buffer.from(payload, 'hex'))

    // Connection setup is its own failure class: if we cannot reach the node at all, nothing was
    // transmitted. Reporting that as `neverSent` lets the caller roll back a pre-broadcast anchor
    // and try again later, instead of stranding a tx that was never actually sent. Everything
    // after this point may have reached the node, so none of it is safely retryable.
    let client: StargateClient
    try {
      client = await this.getStargateClient()
    } catch (error) {
      const err = error as { message?: string }
      this.logger.error('sendTransaction: RPC unreachable, nothing was broadcast', { message: err.message })
      return {
        transactionHash: localHash,
        success: false,
        rejected: false,
        neverSent: true,
        message: err.message ?? 'RPC unreachable — nothing was broadcast',
      }
    }

    try {
      const transactionHash = await client.broadcastTxSync(txBytes)
      return { transactionHash, success: true, rejected: false }
    } catch (error) {
      // Cosmos SDK unordered dedup: re-broadcasting identical bytes is refused because the tx
      // is already tracked in the unordered nonce cache. That means it IS (or will be) on-chain.
      if (isUnorderedDedupRejection(error)) {
        this.logger.info('sendTransaction: unordered dedup (already broadcast), treating as success', { transactionHash: localHash })
        return {
          transactionHash: localHash,
          code: 0,
          message: 'already broadcast (unordered dedup)',
          success: true,
          rejected: false,
        }
      }

      // CheckTx answered with a non-zero code. Deterministic ones are proof the tx can never
      // land; the codes in INDETERMINATE_CHECKTX_CODES are not (see that constant) and must go
      // to the verifier instead of being written off as failures.
      if (error instanceof BroadcastTxError) {
        // Codespace-scoped: cosmos error codes are namespaced, so code 20/32 only carry the
        // meanings below in the SDK root codespace. A module error that happens to reuse those
        // numbers must NOT inherit the indeterminate treatment.
        const indeterminate = error.codespace === 'sdk' && INDETERMINATE_CHECKTX_CODES.has(error.code)
        const level = indeterminate ? 'warn' : 'error'
        this.logger[level](
          indeterminate
            ? 'sendTransaction: CheckTx code is indeterminate (tx may still land, not rejected)'
            : 'sendTransaction: hard CheckTx rejection',
          { code: error.code, codespace: error.codespace, message: error.message },
        )
        return {
          transactionHash: localHash,
          success: false,
          rejected: !indeterminate,
          code: error.code,
          codespace: error.codespace,
          // `.log` is the clean ABCI error; `.message` is the verbose cosmjs wrapper.
          message: error.log ?? error.message ?? 'broadcast rejected',
        }
      }

      // Timeout: the node never answered, but may well have accepted the tx. Outcome UNKNOWN.
      if (error instanceof TimeoutError) {
        this.logger.warn('sendTransaction: RPC timeout (tx may still land, not rejected)', { transactionHash: localHash, message: error.message })
        return {
          transactionHash: localHash,
          success: false,
          rejected: false,
          isTimeout: true,
          message: `RPC timeout waiting for broadcast confirmation — tx may still land: ${error.message}`,
        }
      }

      // Anything else (socket reset, proxy 5xx, DNS): same unknown-outcome class as a timeout.
      const err = error as { code?: number; codespace?: string; message?: string; log?: string }
      this.logger.error('sendTransaction: broadcast failed (outcome unknown, not rejected)', { code: err.code, codespace: err.codespace, message: err.message })
      return {
        transactionHash: localHash,
        success: false,
        rejected: false,
        code: typeof err.code === 'number' ? err.code : undefined,
        codespace: err.codespace,
        message: err.log ?? err.message,
      }
    }
  }

  /**
   * Retrieves transaction details by transaction hash using a 3-tier fallback:
   *   Tier 1: RPC tx_index via StargateClient.getTx
   *   Tier 2: REST API lookup (requires apiUrl)
   *   Tier 3: Block scan using SHA256 hash matching (requires height)
   * @param txHash The transaction hash to look up
   * @param height Optional block height hint for Tier 3 block scan
   * @returns Transaction details or null if not found
   */
  async getTransaction(txHash: string, height?: number): Promise<TransactionResult | null> {
    // Tier 1 + Tier 2: keep the back-compat behavior of swallowing an RPC error
    // (Tier 1) and continuing to the lower tiers instead of failing the lookup.
    let direct: TransactionResult | null = null
    try {
      direct = await this.getTransactionDirect(txHash)
    } catch (error) {
      this.logger.warn('Tier 1 (RPC getTx) failed', { txHash, error })
      // Tier 1 errored; still attempt Tier 2 (REST API).
      const apiResult = await this.getTransactionViaApi(txHash)
      if (apiResult) return apiResult
    }
    if (direct) return direct

    // Tier 3: Block scan
    if (height) {
      this.logger.info('Tier 2 returned null, trying block scan', { txHash, height })
      const blockResult = await this.getTransactionFromBlock(txHash, height)
      if (blockResult) return blockResult
    }

    this.logger.warn('All tiers failed to find transaction', { txHash, height })
    return null
  }

  /**
   * Tier 1 (RPC tx_index) + Tier 2 (REST API) lookup. Unlike {@link getTransaction},
   * this THROWS if the Tier 1 RPC call errors (so callers can distinguish an
   * unreachable RPC from an answered "not found"). Returns null only when both
   * tiers answered and the tx was not present.
   */
  private async getTransactionDirect(txHash: string): Promise<TransactionResult | null> {
    const client = await this.getStargateClient()

    // Tier 1: RPC tx_index (throws on RPC error).
    const tx = await client.getTx(txHash)
    if (tx) {
      return {
        hash: txHash,
        height: tx.height,
        index: tx.txIndex,
        gasUsed: tx.gasUsed,
        gasWanted: tx.gasWanted,
        success: tx.code === 0,
        code: tx.code,
        rawLog: tx.rawLog,
      }
    }

    // Tier 2: REST API
    this.logger.info('Tier 1 did not find TX, trying REST API fallback', { txHash })
    const apiResult = await this.getTransactionViaApi(txHash)
    if (apiResult) return apiResult

    return null
  }

  /**
   * Tri-state hash verification over [startHeight, min(chainHead, startHeight+maxBlocks-1)].
   * confirmed  → tx found (Tier 1 RPC, Tier 2 API, or Tier 3 block scan)
   * absent     → every height in the (head-capped) window was scanned, tx not present
   * unavailable→ the chain head or any block in the window could not be read
   */
  async verifyTransaction(
    txHash: string,
    startHeight: number,
    maxBlocks = 30,
  ): Promise<VerifyOutcome<TransactionResult>> {
    // Tier 1 + Tier 2: a direct hit short-circuits. A Tier-1 RPC error does NOT
    // abort verification: the Tier-3 block scan below is the authoritative coverage
    // mechanism (works even when tx indexing is disabled on the RPC node).
    try {
      const direct = await this.getTransactionDirect(txHash)
      if (direct) return { status: 'confirmed', data: direct }
    } catch (error) {
      this.logger.warn('verifyTransaction: Tier 1/2 lookup failed; falling through to block scan', { txHash, error })
    }

    let head: number
    try {
      head = await this.getHeight()
    } catch {
      return { status: 'unavailable' }
    }

    const endHeight = Math.min(startHeight + maxBlocks - 1, head)
    if (endHeight < startHeight) {
      // Caught up to the chain head: no new blocks to scan. This is a HEALTHY
      // answer ("absent so far"), not an RPC outage — do not inflate backoff.
      return { status: 'absent', coveredUpToHeight: startHeight - 1 }
    }

    const comet = await this.getCometClient()
    const normalizedHash = txHash.toUpperCase()
    let lastBlockTime: Date | undefined
    for (let h = startHeight; h <= endHeight; h++) {
      let block
      try {
        block = await comet.block(h)
      } catch (error) {
        this.logger.warn('verifyTransaction: block fetch failed', { txHash, height: h, error })
        return { status: 'unavailable' } // could not cover the window
      }
      // Track the time of the last successfully fetched block so callers can use
      // chain block time (not wall-clock) for unordered tx expiry decisions.
      if (block.block?.header?.time) {
        lastBlockTime = new Date(block.block.header.time.getTime())
      }
      const match = await this.matchTxInBlock(comet, block, h, normalizedHash, txHash)
      if (match === 'no-match') continue
      // Hash matched in this block but its result row is missing — the tx IS
      // on-chain, we just can't read its outcome. That is NOT negative evidence;
      // treat as unavailable so the verifier keeps retrying instead of failing.
      if (match === 'result-missing' || match === 'result-unreadable') {
        this.logger.warn(
          match === 'result-missing'
            ? 'verifyTransaction: matched tx has no block result entry'
            : 'verifyTransaction: matched tx result row could not be read',
          { txHash, height: h },
        )
        return { status: 'unavailable' }
      }
      return { status: 'confirmed', data: match }
    }
    return { status: 'absent', coveredUpToHeight: endHeight, coveredBlockTime: lastBlockTime }
  }

  /**
   * Returns the chain block time of the latest block (NOT wall-clock).
   * Used by isSignedTxExpired to determine if an unordered tx's timeout_timestamp
   * has passed per chain time, avoiding clock-skew split-brain.
   */
  async getLatestBlockTime(): Promise<Date | null> {
    try {
      const comet = await this.getCometClient()
      const status = await comet.status()
      const t = status.syncInfo?.latestBlockTime
      return t ? new Date(t.getTime()) : null
    } catch {
      return null
    }
  }

  /**
   * Scans the already-fetched `block` at `height` for the tx whose SHA256 equals
   * `normalizedHash`. Returns the built TransactionResult on a hit, 'no-match' if
   * the hash is not in this block, 'result-missing' if blockResults had no entry
   * at the matched index, or 'result-unreadable' if the blockResults call itself
   * failed. The last two are kept apart so the logs say which one happened; both
   * mean the same thing to the caller (the tx is on-chain, its outcome is not
   * readable yet) and both map to `unavailable`.
   */
  private async matchTxInBlock(
    comet: Awaited<ReturnType<typeof this.getCometClient>>,
    block: Awaited<ReturnType<Awaited<ReturnType<typeof this.getCometClient>>['block']>>,
    height: number,
    normalizedHash: string,
    txHash: string,
  ): Promise<TransactionResult | 'no-match' | 'result-missing' | 'result-unreadable'> {
    const txs = block.block.txs
    for (let i = 0; i < txs.length; i++) {
      const bytes = txs[i]
      if (!bytes) continue
      if (toHex(sha256(bytes)).toUpperCase() === normalizedHash) {
        // The hash matched, so the block store already holds this height. Its ABCI
        // responses may still be unreadable — a node that has just saved the block
        // but not yet persisted its results answers "could not find results for
        // height #N" (observed on mainnet at the commit boundary of a block). That
        // is a transient read failure over a tx we KNOW is on-chain, so it must
        // degrade to 'result-missing' -> unavailable, never escape as a throw and
        // fail the caller's activity.
        let results
        try {
          results = await comet.blockResults(height)
        } catch (error) {
          this.logger.warn('matchTxInBlock: blockResults failed for a matched tx', { txHash, height, error })
          return 'result-unreadable'
        }
        const txData = results.results[i]
        if (!txData) return 'result-missing'
        return { hash: txHash, height, index: i, gasUsed: txData.gasUsed, gasWanted: txData.gasWanted, success: txData.code === 0, code: txData.code, rawLog: txData.log }
      }
    }
    return 'no-match'
  }

  private async getTransactionViaApi(txHash: string): Promise<TransactionResult | null> {
    if (!this.apiUrl) return null
    const url = `${this.apiUrl.replace(/\/$/, '')}/cosmos/tx/v1beta1/txs/${txHash}`
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const data = await response.json()
      const txResponse = data.tx_response
      if (!txResponse) return null
      return {
        hash: txResponse.txhash,
        height: parseInt(txResponse.height, 10),
        index: txResponse.tx_index ?? undefined,
        gasUsed: BigInt(txResponse.gas_used || '0'),
        gasWanted: BigInt(txResponse.gas_wanted || '0'),
        success: txResponse.code === 0,
        code: txResponse.code,
        rawLog: txResponse.raw_log ?? undefined,
      }
    } catch (error) {
      this.logger.warn('API tx lookup failed', { txHash, error })
      return null
    }
  }

  private async getTransactionFromBlock(txHash: string, startHeight: number, maxBlocks = 30): Promise<TransactionResult | null> {
    const comet = await this.getCometClient()
    const normalizedHash = txHash.toUpperCase()


    let latestHeight: number
    try {
      latestHeight = await this.getHeight()
    } catch (error) {
      this.logger.warn('Block scan: failed to read chain head, scanning full window', { txHash, startHeight, error })
      latestHeight = startHeight + maxBlocks - 1
    }

    const endHeight = Math.min(startHeight + maxBlocks - 1, latestHeight)
    if (endHeight < startHeight) {
      // The tx height is ahead of the current head; nothing to scan yet.
      return null
    }

    const heights: number[] = []
    for (let h = startHeight; h <= endHeight; h++) heights.push(h)

    // Fetch candidate blocks in parallel, but bounded
    const blocks = await mapWithConcurrency(heights, BLOCK_SCAN_CONCURRENCY, async (h) => {
      try {
        return { h, block: await comet.block(h) }
      } catch (error) {
        this.logger.warn('Block scan error at height', { txHash, height: h, error })
        return { h, block: null }
      }
    })

    // Iterate in ascending height order so we deterministically return the first
    // (lowest-height) match, preserving the previous sequential behavior.
    for (const { h, block } of blocks) {
      if (!block) continue
      const match = await this.matchTxInBlock(comet, block, h, normalizedHash, txHash)
      if (match === 'no-match') continue
      if (match === 'result-missing' || match === 'result-unreadable') {
        this.logger.warn(
          match === 'result-missing'
            ? 'Block results missing entry for matched TX'
            : 'Block results unreadable for matched TX',
          { txHash, height: h },
        )
        return null
      }
      return match
    }
    return null
  }

  /**
   * Retrieves the supplier address for a given address.
   * @param address Supplier address to look up.
   * @param height The height to query for.
   * @returns The supplier address or null if not found.
   */
  async getSupplier(address: string, height?: number): Promise<Supplier | null> {
    const client = await this.getCometClient()
    const queryClient = getQueryClient(client, height)

    try {
      return await queryClient.supplier.getSupplier(address)
    } catch (e) {
      if((e as Error).message.includes('code = NotFound')) {
        return null
      }
      throw e
    }
  }

  /**
   * Tri-state state-based verification of a supplier-mutating tx's expected effect.
   * confirmed  → the supplier state reflects the expected effect
   * absent     → the RPC answered (supplier found or NotFound) but the effect is not present
   * unavailable→ the supplier query could not be read (non-NotFound error)
   *
   * Note: {@link getSupplier} returns `null` on `code = NotFound` (answered-absent) and
   * rethrows otherwise (unavailable).
   */
  async verifySupplierEffect(
    operatorAddress: string,
    effect: SupplierEffect,
    height?: number,
  ): Promise<VerifyOutcome<Supplier>> {
    let supplier: Supplier | null
    try {
      supplier = await this.getSupplier(operatorAddress, height)
    } catch {
      return { status: 'unavailable' }
    }
    // Not load-bearing: decideVerification ignores the supplier path's coveredUpToHeight
    // (only the hash path's window-coverage drives the failure verdict). 0 = "queried latest".
    const coveredUpToHeight = height ?? 0
    if (!supplier) return { status: 'absent', coveredUpToHeight }

    switch (effect.kind) {
      case 'stake-services-present':
        // Goal: supplier exists, owner matches, AND has services on-chain (or pending
        // in serviceConfigHistory). Existence alone would false-confirm an OwnerInitialStake
        // because the supplier pre-exists with zero services — that is the trigger condition.
        return supplier.ownerAddress === effect.ownerAddress &&
          ((supplier.services?.length ?? 0) > 0 || (supplier.serviceConfigHistory?.length ?? 0) > 0)
          ? { status: 'confirmed', data: supplier }
          : { status: 'absent', coveredUpToHeight }
      case 'upstake': {
        const staked = BigInt(supplier.stake?.amount ?? '0')
        return supplier.ownerAddress === effect.ownerAddress && staked >= effect.minStakeUpokt
          ? { status: 'confirmed', data: supplier }
          : { status: 'absent', coveredUpToHeight }
      }
      case 'unstake':
        // Guard against a pre-existing unstake: a node already unbonding from an
        // earlier session would show unstakeSessionEndHeight > 0 even if THIS
        // unstake never landed. Our unstake sets a session end at/after the
        // broadcast height, so require it to clear that floor before confirming.
        return supplier.unstakeSessionEndHeight >= effect.minSessionEndHeight
          ? { status: 'confirmed', data: supplier }
          : { status: 'absent', coveredUpToHeight }
    }
  }

  /** Injectable clock — default Date.now(). Override in tests for determinism. */
  protected nowMs(): number {
    return Date.now()
  }

  /**
   * Generic unordered tx signer. Builds a TxBody with unordered=true and
   * timeoutTimestamp = now + UNORDERED_TIMEOUT_MS, estimates gas, signs with
   * sequence=0, and returns the signed bytes + hash + timeout without broadcasting.
   *
   * All public sign methods (signSupplierTx, signUnstakeTx, signSendTx) delegate here.
   *
   * @param feeUpoktOverride - When set, skips gas simulation and builds an explicit fee of
   *   `{ amount: [{ denom: 'upokt', amount: String(feeUpoktOverride) }], gas: String(gasLimit) }`.
   *   Used by drain (return_funds) flows where the activity must subtract the EXACT same fee
   *   it tells the signer to use, preventing amount/fee drift.
   */
  private async signUnorderedTx(
    signerPrivateKey: string,
    signer: string,
    registryEntries: ReadonlyArray<[string, GeneratedType]>,
    msgs: ReadonlyArray<{ typeUrl: string; value: unknown }>,
    feeUpoktOverride?: number,
    gasLimitOverride?: number,
  ): Promise<{ signedPayload: string; transactionHash: string; timeoutTimestamp: Date }> {
    if (!isValidPrivateKey(signerPrivateKey)) throw new Error('Invalid secp256k1 private key')

    const pkBytes = Uint8Array.from(Buffer.from(signerPrivateKey, 'hex'))
    const wallet = await DirectSecp256k1Wallet.fromKey(pkBytes, 'pokt')

    const registry = new Registry(registryEntries as Array<[string, GeneratedType]>)
    const signingClient = await this.getSigningClient(wallet, registry)

    const latestBlockTime = await this.getLatestBlockTime()
    const timeoutTimestamp = new Date((latestBlockTime?.getTime() ?? this.nowMs()) + UNORDERED_TIMEOUT_MS)

    // StdFee shape: amount (readonly Coin[]), gas (string), granter?, payer?
    let feeAmount: readonly { denom: string; amount: string }[]
    let feeGas: string
    let feeGranter: string | undefined
    let feePayer: string | undefined
    if (feeUpoktOverride !== undefined) {
      // Explicit fee path: used when the caller must pre-compute and subtract the exact
      // fee (e.g. drain flows). Default gas ceiling 200_000 (single MsgSend); callers with
      // more messages (e.g. unstake+send) pass a higher gasLimitOverride.
      const gasLimit = gasLimitOverride ?? 200_000
      feeAmount = [{ denom: this.denom, amount: String(feeUpoktOverride) }]
      feeGas = String(gasLimit)
    } else {
      // Estimate gas; fallback 350_000 matches stakeSupplier behavior
      let gasEstimation: number
      try {
        gasEstimation = await signingClient.simulate(signer, msgs as any, '')
      } catch (simErr: any) {
        this.logger.warn('signUnorderedTx: simulate failed, using fallback gas', { signer, error: simErr?.message ?? simErr })
        gasEstimation = 350_000
      }
      const stdFee = calculateFee(Math.round(gasEstimation * 1.3), this.gasPrice!)
      feeAmount = stdFee.amount
      feeGas = stdFee.gas
      feeGranter = stdFee.granter
      feePayer = stdFee.payer
    }

    // Build TxBody with LOCAL proto (has unordered + timeoutTimestamp fields)
    const encodedMsgs = msgs.map((m) => registry.encodeAsAny(m as any))
    const bodyBytes = TxBody.encode(TxBody.fromPartial({
      messages: encodedMsgs as any,
      memo: '',
      unordered: true,
      timeoutTimestamp,
    })).finish()

    // Get accountNumber (sequence is not used for unordered; passes 0 in authInfo)
    const { accountNumber } = await signingClient.getSequence(signer)
    const chainId = await signingClient.getChainId()

    const [account] = await wallet.getAccounts()
    if (!account) throw new Error('signUnorderedTx: wallet has no accounts')

    const pubkey = encodePubkey(encodeSecp256k1Pubkey(account.pubkey))
    const authInfoBytes = makeAuthInfoBytes(
      [{ pubkey, sequence: 0 }],
      feeAmount,
      Number(feeGas),
      feeGranter,
      feePayer,
    )
    const signDoc = makeSignDoc(bodyBytes, authInfoBytes, chainId, accountNumber)
    const { signature, signed } = await wallet.signDirect(signer, signDoc)

    const txBytes = TxRaw.encode(TxRaw.fromPartial({
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      signatures: [fromBase64(signature.signature)],
    })).finish()

    const transactionHash = toHex(sha256(txBytes)).toUpperCase()
    const signedPayload = Buffer.from(txBytes).toString('base64')

    return { signedPayload, transactionHash, timeoutTimestamp }
  }

  /**
   * Signs a supplier stake tx with unordered=true (no sequence needed).
   * Returns signed bytes + hash WITHOUT broadcasting.
   * The caller must persist these before calling broadcastSupplierTx.
   */
  async signSupplierTx(params: StakeSupplierParams): Promise<{ signedPayload: string; transactionHash: string; timeoutTimestamp: Date }> {
    const { signerPrivateKey, signer, ...value } = params

    if (!signer) throw new Error('`signer` (bech32) is required')

    const typeUrl = '/pocket.supplier.MsgStakeSupplier'
    const result = await this.signUnorderedTx(
      signerPrivateKey,
      signer,
      [[typeUrl, MsgStakeSupplier as unknown as GeneratedType]],
      [{ typeUrl, value: { signer, ...value } as MsgStakeSupplier }],
    )

    this.logger.info('signSupplierTx: signed unordered tx', { signer, transactionHash: result.transactionHash, timeoutTimestamp: result.timeoutTimestamp })

    return result
  }

  /**
   * Signs an unstake tx with unordered=true (no sequence needed).
   * Returns signed bytes + hash WITHOUT broadcasting.
   * The caller must persist these before broadcasting.
   */
  async signUnstakeTx(params: UnstakeSupplierParams): Promise<{ signedPayload: string; transactionHash: string; timeoutTimestamp: Date }> {
    const { signerPrivateKey, signer, ...value } = params

    if (!signer) throw new Error('`signer` (bech32) is required')

    const typeUrl = '/pocket.supplier.MsgUnstakeSupplier'
    const result = await this.signUnorderedTx(
      signerPrivateKey,
      signer,
      [[typeUrl, MsgUnstakeSupplier as unknown as GeneratedType]],
      [{ typeUrl, value: { signer, ...value } as MsgUnstakeSupplier }],
    )

    this.logger.info('signUnstakeTx: signed unordered tx', { signer, transactionHash: result.transactionHash, timeoutTimestamp: result.timeoutTimestamp })

    return result
  }

  /**
   * Signs a MsgSend (fund transfer) tx with unordered=true (no sequence needed).
   * Returns signed bytes + hash WITHOUT broadcasting.
   * The caller must persist these before broadcasting.
   *
   * @param feeUpoktOverride - When set, attaches an explicit fee of this many upokt instead
   *   of simulating gas. Pass the SAME value used to compute the send amount so fees are
   *   exactly consistent (no drift between what is subtracted and what the chain deducts).
   */
  async signSendTx(params: SendFundsParams, feeUpoktOverride?: number): Promise<{ signedPayload: string; transactionHash: string; timeoutTimestamp: Date }> {
    const { signerPrivateKey, fromAddress, ...value } = params

    if (!fromAddress) throw new Error('`fromAddress` (bech32) is required')

    const typeUrl = '/cosmos.bank.v1beta1.MsgSend'
    const result = await this.signUnorderedTx(
      signerPrivateKey,
      fromAddress,
      [[typeUrl, MsgSend as unknown as GeneratedType]],
      [{ typeUrl, value: { fromAddress, ...value } as MsgSend }],
      feeUpoktOverride,
    )

    this.logger.info('signSendTx: signed unordered tx', { fromAddress, transactionHash: result.transactionHash, timeoutTimestamp: result.timeoutTimestamp })

    return result
  }

  /**
   * Signs ONE unordered tx containing a MsgUnstakeSupplier and (optionally) a MsgSend that
   * drains the operator's remaining balance. Both messages are signed by the operator key.
   * Used by the provider-initiated unstake (atomic unstake + return-funds), mirroring the
   * middleman's stake+funds single-tx pattern. The send amount must be pre-computed by the
   * caller as `spendable - feeUpoktOverride` so the operator account lands at exactly 0.
   */
  async signUnstakeAndDrainTx(p: {
    signerPrivateKey: string;
    operatorAddress: string;
    drainTo?: string;
    drainAmount?: string;
    feeUpoktOverride?: number;
  }): Promise<{ signedPayload: string; transactionHash: string; timeoutTimestamp: Date }> {
    const { signerPrivateKey, operatorAddress, drainTo, drainAmount, feeUpoktOverride } = p
    if (!operatorAddress) throw new Error('`operatorAddress` (bech32) is required')

    const unstakeTypeUrl = '/pocket.supplier.MsgUnstakeSupplier'
    const sendTypeUrl = '/cosmos.bank.v1beta1.MsgSend'

    const registryEntries: Array<[string, GeneratedType]> = [
      [unstakeTypeUrl, MsgUnstakeSupplier as unknown as GeneratedType],
    ]
    const msgs: Array<{ typeUrl: string; value: unknown }> = [
      { typeUrl: unstakeTypeUrl, value: { signer: operatorAddress, operatorAddress } as MsgUnstakeSupplier },
    ]
    if (drainTo && drainAmount) {
      registryEntries.push([sendTypeUrl, MsgSend as unknown as GeneratedType])
      msgs.push({
        typeUrl: sendTypeUrl,
        value: { fromAddress: operatorAddress, toAddress: drainTo, amount: [{ denom: this.denom, amount: drainAmount }] } as MsgSend,
      })
    }

    // Combined unstake+send needs more gas than a single message; 500_000 keeps the effective
    // gas price (fee/gas = feeUpoktOverride/500000) safely above the 0.001 upokt minimum.
    const result = await this.signUnorderedTx(
      signerPrivateKey,
      operatorAddress,
      registryEntries,
      msgs,
      feeUpoktOverride,
      drainTo ? 500_000 : undefined,
    )

    this.logger.info('signUnstakeAndDrainTx: signed unordered tx', { operatorAddress, drained: Boolean(drainTo), transactionHash: result.transactionHash })

    return result
  }

  /**
   * Returns the spendable upokt balance for `address`.
   * Unlike `getBalance` (total), this excludes vesting/locked coins.
   */
  async getSpendableBalance(address: string, height?: number): Promise<number> {
    const client = await this.getCometClient()
    const queryClient = getQueryClient(client, height)
    const coin = await queryClient.bank.spendableBalanceByDenom(address, this.denom)
    return parseInt(coin.amount, 10)
  }

  /**
   * Broadcasts a pre-signed tx (from signSupplierTx). Idempotent: a cosmos-sdk
   * unordered-dedup rejection (same timeoutTimestamp+sender seen twice) is treated
   * as success so re-broadcast of identical bytes is safe.
   */
  async broadcastSupplierTx(signedPayloadBase64: string): Promise<SendTransactionResult> {
    const txBytes = Uint8Array.from(Buffer.from(signedPayloadBase64, 'base64'))
    const transactionHash = toHex(sha256(txBytes)).toUpperCase()

    const client = await this.getStargateClient()

    try {
      const result = await (client as any).broadcastTx(txBytes)
      return {
        transactionHash: result.transactionHash ?? transactionHash,
        code: result.code,
        message: result.rawLog,
        success: result.code === 0,
        // A non-zero code from broadcastTx is a definitive CheckTx/DeliverTx rejection.
        rejected: result.code !== 0,
      }
    } catch (e: any) {
      // Cosmos SDK unordered dedup: broadcast of identical (timeoutTimestamp, sender) bytes
      // is rejected because the tx is already tracked in the unordered nonce cache.
      // Treat as idempotent success — the tx is (or will be) included on-chain.
      if (isUnorderedDedupRejection(e)) {
        this.logger.info('broadcastSupplierTx: unordered dedup (already broadcast), treating as success', { transactionHash })
        return {
          transactionHash,
          code: 0,
          message: 'already broadcast (unordered dedup)',
          success: true,
          rejected: false,
        }
      }

      // A BroadcastTxError is a hard CheckTx rejection — the tx will never land on-chain.
      if (e instanceof BroadcastTxError) {
        this.logger.error('broadcastSupplierTx: hard CheckTx rejection', { code: e.code, codespace: e.codespace, message: e.message })
        return {
          transactionHash,
          success: false,
          rejected: true,
          code: e.code,
          // `.log` is the clean ABCI error; `.message` is the verbose cosmjs wrapper.
          message: e.log ?? e.message ?? 'broadcast rejected',
        }
      }

      // A TimeoutError means the RPC timed out waiting for commit confirmation, but the tx
      // may already have been accepted into the mempool and can still land on-chain.
      // Do NOT mark as rejected — the verifier will resolve it via chain-time bound.
      if (e instanceof TimeoutError) {
        this.logger.warn('broadcastSupplierTx: RPC timeout (tx may still land, not rejected)', { transactionHash, message: e.message })
        return {
          transactionHash,
          success: false,
          rejected: false,
          code: undefined,
          message: `RPC timeout waiting for commit confirmation — tx may still land: ${e.message}`,
        }
      }

      this.logger.error('broadcastSupplierTx: broadcast failed', { code: e.code, codespace: e.codespace, message: e.message })
      return {
        transactionHash,
        success: false,
        rejected: false,
        code: e.code,
        // Prefer the clean ABCI `.log` when present (undefined on non-cosmjs errors).
        message: e.log ?? e.message ?? 'broadcast failed',
      }
    }
  }

  /**
   * @deprecated Use signSupplierTx + broadcastSupplierTx (Task 3 canonical lifecycle).
   * remediateSupplier (the only caller) will switch in Task 7.
   */
  async stakeSupplier(params: StakeSupplierParams, explicitSequence?: number): Promise<SendTransactionResult> {
    const { signerPrivateKey, signer, ...value } = params

    this.logger.info('stakeSupplier: Execution started', { params: { signer, ...value }, explicitSequence })

    if (!isValidPrivateKey(signerPrivateKey)) throw new Error('Invalid secp256k1 private key')
    if (!signer) throw new Error('`signer` (bech32) is required')

    this.logger.debug('stakeSupplier: Validated params', { params: { signer, ...value } })

    const pkBytes = Uint8Array.from(Buffer.from(signerPrivateKey, 'hex'))
    const wallet = await DirectSecp256k1Wallet.fromKey(pkBytes, 'pokt')
    const typeUrl = '/pocket.supplier.MsgStakeSupplier'

    let currentHeight = 0
    try {
      const [account] = await wallet.getAccounts()

      this.logger.debug('stakeSupplier: Wallet accounts retrieved');

      if (account && account?.address !== signer) {
        throw new Error(`Signer address mismatch. Wallet=${account?.address} provided=${signer}`)
      }

      this.logger.debug('stakeSupplier: Wallet accounts validated');

      const registry = new Registry([
        [typeUrl, MsgStakeSupplier as unknown as GeneratedType],
      ])

      const signingClient = await this.getSigningClient(wallet, registry)

      this.logger.debug('stakeSupplier: Signing client created');

      const msg = { typeUrl, value: { signer, ...value } as MsgStakeSupplier }

      // TODO: Create signed memo
      currentHeight = await this.getHeight();

      this.logger.debug('stakeSupplier: Signing and broadcasting transaction', {
        currentHeight,
        signer,
        messages: [msg],
        fee: 'auto',
        explicitSequence,
      })

      let result
      if (explicitSequence != null) {
        // Use explicit sequence to avoid sequence mismatch on retry
        this.logger.info('stakeSupplier: Using explicit sequence for signing', { signer, explicitSequence })
        let gasEstimation: number
        try {
          gasEstimation = await signingClient.simulate(signer, [msg], '')
        } catch (simErr: any) {
          this.logger.warn('stakeSupplier: simulate failed in explicit-sequence path, using fallback gas estimate', { signer, error: simErr?.message ? simErr.message : simErr })
          gasEstimation = 350_000
        }
        const fee = calculateFee(Math.round(gasEstimation * 1.3), this.gasPrice!)
        const { accountNumber } = await signingClient.getSequence(signer)
        const chainId = await signingClient.getChainId()
        this.logger.debug('stakeSupplier: Signing with explicit signer data', { signer, accountNumber, explicitSequence, chainId })
        const txRaw = await signingClient.sign(signer, [msg], fee, '', {
          accountNumber,
          sequence: explicitSequence,
          chainId,
        }, BigInt(currentHeight + TX_EXPIRATION_BLOCKS))
        const txBytes = TxRaw.encode(TxRaw.fromPartial(txRaw as any)).finish()
        this.logger.debug('stakeSupplier: Broadcasting transaction with explicit sequence', { signer })
        result = await signingClient.broadcastTx(txBytes)
      } else {
        result = await signingClient.signAndBroadcast(signer, [msg], 'auto', '', BigInt(currentHeight + TX_EXPIRATION_BLOCKS))
      }

      this.logger.info('stakeSupplier: Execution ended. Transaction sent.', { result })

      return {
        transactionHash: result.transactionHash,
        code: result.code,
        message: result.rawLog,
        success: true,
        signedAtHeight: currentHeight,
        timeoutHeight: currentHeight + TX_EXPIRATION_BLOCKS,
      }
    } catch (e: any) {
      const errorMessage = e.log && e.message ? `${e.log} - ${e.message}` : e.message ?? 'Unknown error'
      this.logger.error('stakeSupplier: An error occurred while trying to execute the transaction.', { code: e.code, message: e.message, log: e.log })
      if (e instanceof BroadcastTxError) {
        return {
          transactionHash: '',
          success: false,
          code: e.code,
          message: errorMessage,
          signedAtHeight: currentHeight,
          timeoutHeight: currentHeight + TX_EXPIRATION_BLOCKS,
        }
      }

      if (e instanceof TimeoutError) {
        return {
          transactionHash: e.txId,
          success: false,
          message: `Transaction timed out. This does not indicate a failure. Details: ${errorMessage}`,
          code: 42, // Timeout Transaction error code. See: https://github.com/cosmos/cosmos-sdk/blob/main/types/errors/errors.go
          signedAtHeight: currentHeight,
          timeoutHeight: currentHeight + TX_EXPIRATION_BLOCKS,
        }
      }

      this.logger.info('stakeSupplier: Execution ended  in errors.', { error: e })

      return {
        transactionHash: '',
        success: false,
        message: `An unknown error occurred: ${errorMessage}`,
        signedAtHeight: currentHeight,
        timeoutHeight: currentHeight + TX_EXPIRATION_BLOCKS,
      }
    }
  }

  /**
   * Sequence-consumed evidence for a broadcast tx. If account.sequence > txSequence,
   * the tx can NEVER land in a block after `observedAtHeight` (its sequence was
   * consumed — by itself or a replacement). Soundness contract for the caller:
   * a failure verdict additionally requires hash-absence covered up to
   * `observedAtHeight`, because the consumer might have been this very tx in a
   * block the scan has not covered yet. `observedAtHeight` is sampled AT/AFTER the
   * account read so coverage up to it includes every block the tx could occupy.
   */
  async isSequenceConsumed(signer: string, txSequence: number): Promise<{ consumed: boolean; observedAtHeight: number }> {
    const client = await this.getStargateClient()
    const account = await client.getAccount(signer)   // throws on RPC error → caller treats as unavailable
    const observedAtHeight = await this.getHeight()
    if (!account) return { consumed: false, observedAtHeight }
    return { consumed: account.sequence > txSequence, observedAtHeight }
  }

  private async getSigningClient(
    wallet: DirectSecp256k1Wallet,
    registry: Registry,
  ): Promise<SigningStargateClient> {
    const comet = await this.getCometClient()
    return await SigningStargateClient.createWithSigner(comet, wallet, {
      registry,
      gasPrice: this.gasPrice,
      broadcastTimeoutMs: 3 * 60 * 1000,
    })
  }
}
