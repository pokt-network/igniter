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
import {StakeSupplierParams} from "@pocket/types";
import {MsgStakeSupplier} from "@pocket/proto/generated/pocket/supplier/tx";
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
function isUnorderedDedupRejection(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const err = e as Error & { code?: number; codespace?: string; rawLog?: string }
  // code 19 = cometbft ErrTxInCache (same bytes in mempool)
  // code 18 = cosmos-sdk ErrInvalidRequest from verifyUnorderedNonce ("failed to add unordered nonce")
  if (err.codespace === 'sdk' && (err.code === 19 || err.code === 18)) return true
  const msg = String(err?.message ?? err?.rawLog ?? '').toLowerCase()
  if (msg.includes('failed to add unordered nonce')) return true
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
    this.logger = getLogger().child({ service: 'pocket-blockchain' })
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
      console.error('Failed to connect to the blockchain:', error)
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
      console.error(err)
      throw new Error('Unable to fetch the height from the blockchain.')
    }
  }

  /**
   * Broadcasts a signed transaction (hex-encoded) to the network.
   * @param payload hex string of the signed tx bytes
   * @returns transactionHash and the full BroadcastTxResponse
   */
  async sendTransaction(payload: string): Promise<SendTransactionResult> {
    const client = await this.getStargateClient()
    const txBytes = Buffer.from(payload, 'hex')
    try {
      const transactionHash = await client.broadcastTxSync(txBytes)
      return { transactionHash, success: true }
    } catch (error) {
      const { code, message } = error as { code: number; message: string }
      return {
        transactionHash: '',
        success: false,
        code,
        message,
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
      this.logger.warn({ txHash, error }, 'Tier 1 (RPC getTx) failed')
      // Tier 1 errored; still attempt Tier 2 (REST API).
      const apiResult = await this.getTransactionViaApi(txHash)
      if (apiResult) return apiResult
    }
    if (direct) return direct

    // Tier 3: Block scan
    if (height) {
      this.logger.info({ txHash, height }, 'Tier 2 returned null, trying block scan')
      const blockResult = await this.getTransactionFromBlock(txHash, height)
      if (blockResult) return blockResult
    }

    this.logger.warn({ txHash, height }, 'All tiers failed to find transaction')
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
      }
    }

    // Tier 2: REST API
    this.logger.info({ txHash }, 'Tier 1 did not find TX, trying REST API fallback')
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
      this.logger.warn({ txHash, error }, 'verifyTransaction: Tier 1/2 lookup failed; falling through to block scan')
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
        this.logger.warn({ txHash, height: h, error }, 'verifyTransaction: block fetch failed')
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
      if (match === 'result-missing') {
        this.logger.warn({ txHash, height: h }, 'verifyTransaction: matched tx has no block result entry')
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
   * the hash is not in this block, or 'result-missing' if the hash matched but
   * blockResults had no entry at the matched index.
   */
  private async matchTxInBlock(
    comet: Awaited<ReturnType<typeof this.getCometClient>>,
    block: Awaited<ReturnType<Awaited<ReturnType<typeof this.getCometClient>>['block']>>,
    height: number,
    normalizedHash: string,
    txHash: string,
  ): Promise<TransactionResult | 'no-match' | 'result-missing'> {
    const txs = block.block.txs
    for (let i = 0; i < txs.length; i++) {
      const bytes = txs[i]
      if (!bytes) continue
      if (toHex(sha256(bytes)).toUpperCase() === normalizedHash) {
        const results = await comet.blockResults(height)
        const txData = results.results[i]
        if (!txData) return 'result-missing'
        return { hash: txHash, height, index: i, gasUsed: txData.gasUsed, gasWanted: txData.gasWanted, success: txData.code === 0, code: txData.code }
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
      }
    } catch (error) {
      this.logger.warn({ txHash, error }, 'API tx lookup failed')
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
      this.logger.warn({ txHash, startHeight, error }, 'Block scan: failed to read chain head, scanning full window')
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
        this.logger.warn({ txHash, height: h, error }, 'Block scan error at height')
        return { h, block: null }
      }
    })

    // Iterate in ascending height order so we deterministically return the first
    // (lowest-height) match, preserving the previous sequential behavior.
    for (const { h, block } of blocks) {
      if (!block) continue
      const match = await this.matchTxInBlock(comet, block, h, normalizedHash, txHash)
      if (match === 'no-match') continue
      if (match === 'result-missing') {
        this.logger.warn({ txHash, height: h }, 'Block results missing entry for matched TX')
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
   * Signs a supplier stake tx with unordered=true (no sequence needed).
   * Returns signed bytes + hash WITHOUT broadcasting.
   * The caller must persist these before calling broadcastSupplierTx.
   */
  async signSupplierTx(params: StakeSupplierParams): Promise<{ signedPayload: string; transactionHash: string; timeoutTimestamp: Date }> {
    const { signerPrivateKey, signer, ...value } = params

    if (!isValidPrivateKey(signerPrivateKey)) throw new Error('Invalid secp256k1 private key')
    if (!signer) throw new Error('`signer` (bech32) is required')

    const pkBytes = Uint8Array.from(Buffer.from(signerPrivateKey, 'hex'))
    const wallet = await DirectSecp256k1Wallet.fromKey(pkBytes, 'pokt')
    const typeUrl = '/pocket.supplier.MsgStakeSupplier'

    const registry = new Registry([
      [typeUrl, MsgStakeSupplier as unknown as GeneratedType],
    ])

    const signingClient = await this.getSigningClient(wallet, registry)

    const msg = { typeUrl, value: { signer, ...value } as MsgStakeSupplier }

    const timeoutTimestamp = new Date(this.nowMs() + UNORDERED_TIMEOUT_MS)

    // Estimate gas; fallback 350_000 matches old stakeSupplier behavior
    let gasEstimation: number
    try {
      gasEstimation = await signingClient.simulate(signer, [msg], '')
    } catch (simErr: any) {
      this.logger.warn({ signer, error: simErr?.message ?? simErr }, 'signSupplierTx: simulate failed, using fallback gas')
      gasEstimation = 350_000
    }
    const fee = calculateFee(Math.round(gasEstimation * 1.3), this.gasPrice!)

    // Build TxBody with LOCAL proto (has unordered + timeoutTimestamp fields)
    const msgAny = registry.encodeAsAny(msg)
    const bodyBytes = TxBody.encode(TxBody.fromPartial({
      messages: [msgAny as any],
      memo: '',
      unordered: true,
      timeoutTimestamp,
    })).finish()

    // Get accountNumber (sequence is not used for unordered; passes 0 in authInfo)
    const { accountNumber } = await signingClient.getSequence(signer)
    const chainId = await signingClient.getChainId()

    const [account] = await wallet.getAccounts()
    if (!account) throw new Error('signSupplierTx: wallet has no accounts')

    const pubkey = encodePubkey(encodeSecp256k1Pubkey(account.pubkey))
    const authInfoBytes = makeAuthInfoBytes(
      [{ pubkey, sequence: 0 }],
      fee.amount,
      Number(fee.gas),
      fee.granter,
      fee.payer,
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

    this.logger.info({ signer, transactionHash, timeoutTimestamp }, 'signSupplierTx: signed unordered tx')

    return { signedPayload, transactionHash, timeoutTimestamp }
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
        this.logger.info({ transactionHash }, 'broadcastSupplierTx: unordered dedup (already broadcast), treating as success')
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
        this.logger.error({ code: e.code, codespace: e.codespace, message: e.message }, 'broadcastSupplierTx: hard CheckTx rejection')
        return {
          transactionHash,
          success: false,
          rejected: true,
          code: e.code,
          message: e.message ?? 'broadcast rejected',
        }
      }

      // A TimeoutError means the RPC timed out waiting for commit confirmation, but the tx
      // may already have been accepted into the mempool and can still land on-chain.
      // Do NOT mark as rejected — the verifier will resolve it via chain-time bound.
      if (e instanceof TimeoutError) {
        this.logger.warn({ transactionHash, message: e.message }, 'broadcastSupplierTx: RPC timeout (tx may still land, not rejected)')
        return {
          transactionHash,
          success: false,
          rejected: false,
          code: undefined,
          message: `RPC timeout waiting for commit confirmation — tx may still land: ${e.message}`,
        }
      }

      this.logger.error({ code: e.code, codespace: e.codespace, message: e.message }, 'broadcastSupplierTx: broadcast failed')
      return {
        transactionHash,
        success: false,
        rejected: false,
        code: e.code,
        message: e.message ?? 'broadcast failed',
      }
    }
  }

  /**
   * @deprecated Use signSupplierTx + broadcastSupplierTx (Task 3 canonical lifecycle).
   * remediateSupplier (the only caller) will switch in Task 7.
   */
  async stakeSupplier(params: StakeSupplierParams, explicitSequence?: number): Promise<SendTransactionResult> {
    const { signerPrivateKey, signer, ...value } = params

    this.logger.info({ params: { signer, ...value }, explicitSequence },'stakeSupplier: Execution started')

    if (!isValidPrivateKey(signerPrivateKey)) throw new Error('Invalid secp256k1 private key')
    if (!signer) throw new Error('`signer` (bech32) is required')

    this.logger.debug({ params: { signer, ...value } },'stakeSupplier: Validated params')

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

      this.logger.debug({
        currentHeight,
        signer,
        messages: [msg],
        fee: 'auto',
        explicitSequence,
      },'stakeSupplier: Signing and broadcasting transaction')

      let result
      if (explicitSequence != null) {
        // Use explicit sequence to avoid sequence mismatch on retry
        this.logger.info({ signer, explicitSequence }, 'stakeSupplier: Using explicit sequence for signing')
        let gasEstimation: number
        try {
          gasEstimation = await signingClient.simulate(signer, [msg], '')
        } catch (simErr: any) {
          this.logger.warn({ signer, error: simErr?.message ? simErr.message : simErr }, 'stakeSupplier: simulate failed in explicit-sequence path, using fallback gas estimate')
          gasEstimation = 350_000
        }
        const fee = calculateFee(Math.round(gasEstimation * 1.3), this.gasPrice!)
        const { accountNumber } = await signingClient.getSequence(signer)
        const chainId = await signingClient.getChainId()
        this.logger.debug({ signer, accountNumber, explicitSequence, chainId }, 'stakeSupplier: Signing with explicit signer data')
        const txRaw = await signingClient.sign(signer, [msg], fee, '', {
          accountNumber,
          sequence: explicitSequence,
          chainId,
        }, BigInt(currentHeight + TX_EXPIRATION_BLOCKS))
        const txBytes = TxRaw.encode(TxRaw.fromPartial(txRaw as any)).finish()
        this.logger.debug({ signer }, 'stakeSupplier: Broadcasting transaction with explicit sequence')
        result = await signingClient.broadcastTx(txBytes)
      } else {
        result = await signingClient.signAndBroadcast(signer, [msg], 'auto', '', BigInt(currentHeight + TX_EXPIRATION_BLOCKS))
      }

      this.logger.info({ result },'stakeSupplier: Execution ended. Transaction sent.')

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
      this.logger.error({ code: e.code, message: e.message, log: e.log },'stakeSupplier: An error occurred while trying to execute the transaction.')
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

      this.logger.info({ error: e },'stakeSupplier: Execution ended  in errors.')

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
