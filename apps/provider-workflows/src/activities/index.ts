import { randomUUID } from 'crypto'
import type {PocketBlockchain, StakeSupplierParams, SendFundsParams, Supplier, VerifyOutcome, SupplierEffect} from '@igniter/pocket'
import type {ApplicationSettings, InsertKey, Key, KeyWithGroup, Service, Transaction} from '@igniter/db/provider/schema'
import { DEFAULT_NOTIFICATION_FLAGS } from '@igniter/db/provider/schema'
import type {VerificationDecision} from '@igniter/tx-verify'
import {TX_EXPIRATION_BLOCKS} from '@igniter/tx-verify'
import {ApplicationFailure, log} from '@temporalio/activity'
import DAL from '@/lib/dal/DAL'
import {KeysMinMax} from '@/lib/dal/keys'
import {KeyState, RemediationHistoryEntryReason, TransactionType, TransactionStatus, TransactionTrigger, NotificationChannelType} from '@igniter/db/provider/enums'
import {BuildSupplierServiceConfigHandler, CompareSupplierServiceConfigHandler} from '@igniter/domain/provider/operations';
import {addOrUpdateRemediationHistory} from "@/lib/utils";
import {redactStakeSupplierParams} from "@/lib/redactors";
import {getExpectedServicesFromKey} from '@igniter/domain/provider/utils'
import { ServiceConfigUpdate } from '@igniter/pocket/proto/pocket/shared/supplier'
import { createSmtpTransport, dispatchToChannels } from '@igniter/notifications'
import type { DispatchChannel, ChannelDeliveryResult } from '@igniter/notifications'
import type { NotificationEvent } from '@/lib/types/notifications'
import { buildRichMessage } from '@/lib/richMessageBuilder'
import { analyticsActivities } from '@/activities/analytics'
import { isValidPoktAddress } from '@igniter/pocket/utils'
import { parseCdnDelegators, type CdnDelegator } from '@/lib/dal/delegators'
import {
  MAX_GOVERNANCE_BODY_BYTES,
  MAX_GOVERNANCE_ROWS,
  maxChangesPerRun,
  planDelegatorChanges,
} from '@/lib/governance/delegatorsSync'

const errInfo = (e: unknown) => e instanceof Error ? { message: e.message, stack: e.stack } : e

export type Height = number

export type LoadKeysInRangeParams = {
  minId: number;
  maxId: number;
  states: KeyState[];
}

export type LoadKeysInRangeResult = Array<{ id: number; address: string, state: KeyState }>

export type ProcessSupplierParams = {
  address: string;
  /** Ignored: the activity reads the height from chain. Kept so existing callers/history stay valid. */
  height?: number;
}

export type UpsertSupplierStatusResult = {
  state: KeyState;
  remediationReasons: RemediationHistoryEntryReason[];
  prev?: {
    state?: KeyState;
    remediationReasons?: RemediationHistoryEntryReason[];
  };
  /**
   * True only on the sweep where this key becomes "fully staked" — bonded AND with at
   * least one service configured — when it was not fully staked the previous sweep.
   * Services land a sweep after the bare bond, so this fires once, at completion, and
   * drives the single "Suppliers Staked" notification (no premature 0-service alert, no
   * re-alert on later service edits).
   */
  becameFullyStaked?: boolean;
  supplier?: Supplier;
}

export type RemediateSupplierParams = ProcessSupplierParams & {
  reasons: RemediationHistoryEntryReason[];
}

export type GovernanceSyncResult = {
  inserted: number;
  updated: number;
  disabled: number;
}

/** Number of consecutive unavailable checks between critical alerts for a chronically-unverifiable tx. */
const VERIFY_UNAVAILABLE_ALERT_THRESHOLD = Number(process.env.VERIFY_UNAVAILABLE_ALERT_THRESHOLD ?? 50)

// Explicit fee for the drain MsgSend (gasPrice 0.001 upokt; a MsgSend simulates ~70k gas,
// signSendTx applies a 1.3x buffer -> ~91k gas -> ~91 upokt. Round up generously.
// The exact value is validated on localnet (Phase 6); start at 1000 upokt = 0.001 POKT.
// This MUST match the feeUpoktOverride passed to signSendTx so the amount and fee are consistent.
const RETURN_FUNDS_FEE_UPOKT = 1000

// D10: residual balance above this threshold after a drain triggers a warning (observability only).
const DRAIN_DUST_TOLERANCE_UPOKT = RETURN_FUNDS_FEE_UPOKT

export type ReturnFundsChoice =
  | { mode: 'none' }
  | { mode: 'owner' }
  | { mode: 'custom'; address: string }

/**
 * The only return-funds modes a workflow/activity INPUT may carry. Workflow and activity
 * inputs are not trusted to choose a fund destination, so an address never comes from there.
 * A `custom` destination is only honoured when the provider app wrote it into the
 * transaction intent row itself (owner-gated UnstakeKeys action); signSupplierTx re-reads
 * it from the DB by transaction id.
 */
export type ReturnFundsInputChoice = Extract<ReturnFundsChoice, { mode: 'none' | 'owner' }>

export function parseReturnFundsInputChoice(choice: unknown): ReturnFundsInputChoice {
  const mode = (choice as { mode?: unknown } | null | undefined)?.mode
  if (mode === 'none' || mode === 'owner') return { mode }
  throw ApplicationFailure.nonRetryable(
    'returnFunds must be { mode: "owner" } or { mode: "none" }; a custom destination is accepted only from the provider app',
    'invalid_return_funds',
  )
}

/**
 * Sign inputs frozen into `transactions.params`. They NEVER hold the signer private key:
 * signSupplierTx loads and decrypts the key from the keys table at sign time.
 */
export type StoredStakeParams = {
  signer: string;
  ownerAddress: string;
  operatorAddress: string;
  services?: StakeSupplierParams['services'];
  stake?: StakeSupplierParams['stake'];
}
export type StoredUnstakeParams = { signer: string; operatorAddress: string }
export type StoredSendFundsParams = { fromAddress: string; toAddress: string; amount: SendFundsParams['amount'] }

export type TxIntentParams =
  | { kind: 'stake'; params: StoredStakeParams }
  | { kind: 'unstake'; params: StoredUnstakeParams; returnFunds: ReturnFundsChoice }
  | { kind: 'return_funds'; params: StoredSendFundsParams }

/** The reasons remediateSupplier can act on; anything else in a workflow input is dropped. */
const REMEDIABLE_REASONS: ReadonlySet<RemediationHistoryEntryReason> = new Set([
  RemediationHistoryEntryReason.OwnerInitialStake,
  RemediationHistoryEntryReason.ServiceMismatch,
  RemediationHistoryEntryReason.AddressGroupMigration,
])

export function sanitizeRemediationReasons(reasons: unknown): RemediationHistoryEntryReason[] {
  if (!Array.isArray(reasons)) return []
  return [...new Set(reasons.filter((r): r is RemediationHistoryEntryReason => REMEDIABLE_REASONS.has(r)))]
}

const KNOWN_KEY_STATES: ReadonlySet<string> = new Set(Object.values(KeyState))

/** Keeps only real KeyState values (a workflow input picks which keys a sweep loads). */
export function sanitizeKeyStates(states: unknown): KeyState[] {
  if (!Array.isArray(states)) return []
  return [...new Set(states.filter((st): st is KeyState => typeof st === 'string' && KNOWN_KEY_STATES.has(st)))]
}

/** Removes a `signerPrivateKey` a legacy row may still carry, so it is never used or re-stored. */
function withoutSignerKey<T extends object>(params: T): Omit<T, 'signerPrivateKey'> {
  const { signerPrivateKey: _dropped, ...rest } = params as T & { signerPrivateKey?: unknown }
  return rest
}

/**
 * The owner a drain may go to: the stake owner recorded from chain (set once, never
 * overwritten by a later RPC read), else the owner the key was delivered to.
 */
export function recordedOwnerOf(key: { stakeOwner?: string | null; ownerAddress?: string | null }): string | null {
  return key.stakeOwner || key.ownerAddress || null
}

/** Per-sweep hash-scan window, matching the on-chain mempool expiration window. */
// TX_EXPIRATION_BLOCKS imported from @igniter/tx-verify above

/**
 * Maps a provider transaction + its key into the expected on-chain supplier effect.
 * Returns null when the tx has no supplier-state path so the verifier skips the
 * supplier verification path for it.
 */
export function supplierEffectFromKey(
  tx: Transaction,
  key: Pick<Key, 'address' | 'stakeOwner'>,
): { operatorAddress: string; effect: SupplierEffect } | null {
  if (tx.type === TransactionType.Stake) {
    // Goal-state per remediation reason:
    //  - OwnerInitialStake: trigger condition is supplier-present-with-ZERO-services
    //    (upsertSupplierStatus), so the goal is services present — NOT mere existence.
    //  - ServiceMismatch / AddressGroupMigration: a config-update over an existing
    //    supplier; existence proves nothing about THIS tx → hash-only (null).
    if (tx.reason === RemediationHistoryEntryReason.OwnerInitialStake) {
      return {
        operatorAddress: key.address,
        effect: { kind: 'stake-services-present', ownerAddress: key.stakeOwner ?? '' },
      }
    }
    return null
  }

  if (tx.type === TransactionType.Unstake) {
    return {
      operatorAddress: key.address,
      effect: { kind: 'unstake', minSessionEndHeight: tx.executionHeight ?? 0 },
    }
  }

  if (tx.type === TransactionType.ReturnFunds) {
    // A bank send (MsgSend drain) has no supplier-state path: verify is hash-only,
    // exactly like the ServiceMismatch/AddressGroupMigration stake txs.
    return null
  }

  return null
}

/**
 * Pure decision for where a return-funds (drain) MsgSend should send to.
 * No DAL access — the key/choice/settings are passed in so this is trivially
 * unit-testable. Shared by the provider-UI path (explicit per-op `choice`) and
 * the middleman/automatic path (no choice → obey the provider settings flag).
 *
 * Returns the destination address, or null when no drain should happen
 * (mode 'none', flag off, custom with empty address, or no resolvable owner).
 */
export function resolveDrainDestination(
  key: { stakeOwner?: string | null; ownerAddress?: string | null },
  choice: ReturnFundsChoice | undefined,
  settings: { returnSupplierFundsToOwner?: boolean | null } | null,
): string | null {
  if (choice) {
    if (choice.mode === 'none') return null
    if (choice.mode === 'owner') return recordedOwnerOf(key)
    if (choice.mode === 'custom') return isValidPoktAddress(choice.address) ? choice.address : null
    return null
  }
  // No explicit choice (middleman/automatic path): obey the provider setting.
  if (!settings?.returnSupplierFundsToOwner) return null
  return recordedOwnerOf(key)
}

/**
 * Creates a return-funds (MsgSend drain) INTENT row for `keyAddress` → `toAddress`.
 * Module-level (takes `dal` explicitly) so it can be invoked WITHOUT relying on `this`
 * from both the `createReturnFundsIntent` activity method and `maybeCreateReturnFundsIntent`.
 *
 * The send amount is computed at sign time from the live spendable balance;
 * `params.amount` is stored empty as a placeholder.
 * Returns the new tx id, or null if a pending row already exists for this key
 * (createIntent → onConflictDoNothing on the partial UNIQUE(key_id) WHERE pending index).
 */
async function doCreateReturnFundsIntent(dal: DAL, keyAddress: string, toAddress: string): Promise<number | null> {
  const key = await dal.keys.loadKey(keyAddress)
  if (!key) throw ApplicationFailure.nonRetryable(`createReturnFundsIntent: key not found for ${keyAddress}`, 'not_found')
  if (!isValidPoktAddress(toAddress)) {
    throw ApplicationFailure.nonRetryable(`createReturnFundsIntent: invalid destination for ${keyAddress}`, 'invalid_address')
  }
  const params: StoredSendFundsParams = {
    fromAddress: key.address,
    toAddress,
    amount: [], // amount computed at sign time from live spendable balance
  }
  const intent: TxIntentParams = { kind: 'return_funds', params }
  return dal.transactions.createIntent({
    keyId: key.id,
    keyAddress: key.address,
    type: TransactionType.ReturnFunds,
    reason: RemediationHistoryEntryReason.ReturnSupplierFunds,
    trigger: TransactionTrigger.Automatic,
    executionHeight: null,
    params: JSON.stringify(intent),
    reasons: JSON.stringify([]),
  })
}


export const providerActivities = (dal: DAL, pocketRpcClient: PocketBlockchain) => {
  // The block height the status/remediation activities act on is read from chain
  // here, never taken from the workflow input. Cached for a few seconds so a sweep of N
  // keys costs one getHeight, not N.
  const HEIGHT_CACHE_MS = 5_000
  let heightCache: { value: Promise<number>; at: number } | null = null
  const currentHeight = (): Promise<number> => {
    const now = Date.now()
    if (!heightCache || now - heightCache.at >= HEIGHT_CACHE_MS) {
      const value = pocketRpcClient.getHeight()
      const entry = { value, at: now }
      heightCache = entry
      value.catch(() => { if (heightCache === entry) heightCache = null })
    }
    return heightCache.value
  }

  const activities = {
  ...analyticsActivities(dal),

  async syncDelegatorsFromGovernance(): Promise<GovernanceSyncResult> {
    const settings = await dal.settings.loadSettings()
    if (!settings) {
      throw ApplicationFailure.nonRetryable('Application settings not found', 'settings_not_found')
    }

    const cdnUrlTemplate = process.env.DELEGATORS_CDN_URL
    if (!cdnUrlTemplate) {
      throw ApplicationFailure.nonRetryable('DELEGATORS_CDN_URL environment variable is not defined', 'missing_env')
    }

    const cdnUrl = cdnUrlTemplate.replace(
      '{chainId}',
      settings.chainId.replace('lego-testnet', 'beta'),
    )

    log.info('syncDelegatorsFromGovernance: Fetching from CDN', { cdnUrl })

    const response = await fetch(cdnUrl, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) {
      throw ApplicationFailure.retryable(`Failed to fetch delegators: ${response.statusText}`, 'fetch_failed')
    }

    // Bound the body, validate the shape, then preview + cap + log every change
    // before the DAL writes anything.
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_GOVERNANCE_BODY_BYTES) {
      throw ApplicationFailure.nonRetryable('Delegators payload too large', 'invalid_payload')
    }
    const body = await response.text()
    if (body.length > MAX_GOVERNANCE_BODY_BYTES) {
      throw ApplicationFailure.nonRetryable('Delegators payload too large', 'invalid_payload')
    }
    let delegatorsFromCdn: CdnDelegator[]
    try {
      delegatorsFromCdn = parseCdnDelegators(JSON.parse(body))
    } catch (e) {
      throw ApplicationFailure.nonRetryable(`Invalid delegators payload: ${(e as Error).message}`, 'invalid_payload')
    }
    if (delegatorsFromCdn.length > MAX_GOVERNANCE_ROWS) {
      throw ApplicationFailure.nonRetryable(`Delegators payload has ${delegatorsFromCdn.length} rows (max ${MAX_GOVERNANCE_ROWS})`, 'invalid_payload')
    }
    log.info('syncDelegatorsFromGovernance: Fetched delegators', { count: delegatorsFromCdn.length })

    const current = await dal.delegators.listAll()
    const changes = planDelegatorChanges(current, delegatorsFromCdn)
    const cap = maxChangesPerRun()
    if (current.length > 0 && changes.length > cap) {
      log.error('syncDelegatorsFromGovernance: change cap exceeded; nothing applied', { changes: changes.length, cap })
      throw ApplicationFailure.nonRetryable(
        `Governance sync would apply ${changes.length} changes (cap ${cap}); raise GOVERNANCE_MAX_CHANGES_PER_RUN to accept`,
        'change_cap_exceeded',
      )
    }
    for (const change of changes) {
      log.info('syncDelegatorsFromGovernance: change', change)
    }

    const result = await dal.delegators.upsertFromGovernance(
      delegatorsFromCdn,
      settings.ownerIdentity,
    )

    log.info('syncDelegatorsFromGovernance: Done', result)
    return result
  },

  /**
   * Mock activity.
   */
  async mockActivity(): Promise<void> {
    // mock activity
    return
  },
  /**
   * Returns the latest block height from the blockchain.
   * @returns GetLatestBlockResult
   */
  async getLatestBlock(): Promise<Height> {
    return pocketRpcClient.getHeight()
  },

  // ---------------------------------------------------------------------------
  // Canonical lifecycle activities (Task 4)
  // ---------------------------------------------------------------------------

  /**
   * Read a transaction's `status` and `hash` by id — used by child workflow to
   * inspect state. Returns only those two fields because the result is recorded
   * in workflow history. Name kept for replay of in-flight workflows.
   */
  async getTransaction(transactionId: number) {
    return dal.transactions.getTransactionStatus(transactionId)
  },

  /** Dispatcher queue: all pending rows (with or without hash). */
  async listPending() {
    return dal.transactions.listPending()
  },

  // createIntentTx / createReturnFundsIntent are deliberately NOT registered activities:
  // no workflow schedules them, and as activities they took a full StakeSupplierParams /
  // a destination address straight from the (unauthenticated) task input. They are the
  // closure helpers createStakeIntent / doCreateReturnFundsIntent below.

  /**
   * Creates an unstake intent for the given key.
   * Returns the new tx id, or null if:
   *   - a pending row already exists for this key (UNIQUE WHERE pending index)
   *   - the key is already retired (retiredAt set) — never re-unstake
   *
   * `returnFunds` is validated at runtime to `owner` | `none` (see ReturnFundsInputChoice):
   * a custom drain destination is never accepted from a workflow/activity input. The
   * `trigger` input is ignored; a workflow-started unstake is always Manual.
   */
  async createUnstakeIntent(p: { keyAddress: string; returnFunds: ReturnFundsInputChoice }): Promise<number | null> {
    const returnFunds = parseReturnFundsInputChoice(p?.returnFunds)
    const key = await dal.keys.loadKey(p.keyAddress)
    if (!key) throw ApplicationFailure.nonRetryable(`createUnstakeIntent: key not found for ${p.keyAddress}`, 'not_found')
    if (key.retiredAt) return null // already retired — never re-unstake
    const params: StoredUnstakeParams = {
      signer: key.address,
      operatorAddress: key.address,
    }
    const intent: TxIntentParams = { kind: 'unstake', params, returnFunds }
    return dal.transactions.createIntent({
      keyId: key.id,
      keyAddress: key.address,
      type: TransactionType.Unstake,
      reason: RemediationHistoryEntryReason.ManualUnstake,
      trigger: TransactionTrigger.Manual,
      executionHeight: null,
      params: JSON.stringify(intent),
      reasons: JSON.stringify([]),
    })
  },

  /**
   * Child activity: sign (unordered) the row's frozen params; persist bytes + hash + timeout
   * BEFORE broadcast so re-broadcast is idempotent.
   *
   * Dispatches to the correct pocket signer based on the tagged TxIntentParams union.
   *
   * MIGRATION TOLERANCE: In-flight stake intents created before the tagged-union deploy
   * stored raw StakeSupplierParams (no `kind` field). If the parsed object has no `kind`,
   * it is treated as a legacy stake intent: `{ kind: 'stake', params: parsed }`.
   * This prevents breaking any pending stake rows across the deploy boundary.
   */
  async signSupplierTx(transactionId: number): Promise<void> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn?.params) throw new Error(`signSupplierTx: tx ${transactionId} missing params`)

    // Parse tagged union; tolerate legacy shape (no `kind` = pre-migration stake intent).
    const raw = JSON.parse(txn.params)
    const intent: TxIntentParams = ('kind' in raw && raw.kind)
      ? raw as TxIntentParams
      : { kind: 'stake', params: raw as StoredStakeParams }

    // The signer key is loaded (and decrypted) from the keys table NOW, never read
    // from params. A legacy row may still carry a signerPrivateKey; it is dropped unused.
    const key = await dal.keys.loadKey(txn.keyAddress)
    if (!key || (txn.keyId != null && key.id !== txn.keyId)) {
      await dal.transactions.abandonIntent(transactionId, { message: 'sign failed: signing key not found' })
      return
    }
    const signerPrivateKey = key.privateKey
    const p = withoutSignerKey(intent.params as object) as Record<string, unknown>
    // Every address that authorizes the tx must be this row's key: params can never make
    // the worker sign on behalf of another key.
    const signerFields = intent.kind === 'return_funds' ? ['fromAddress'] : ['signer', 'operatorAddress']
    if (signerFields.some((f) => p[f] !== key.address)) {
      log.error('signSupplierTx: intent signer does not match the row key; abandoning', { transactionId, keyAddress: key.address })
      await dal.transactions.abandonIntent(transactionId, { message: 'sign failed: intent signer does not match the transaction key' })
      return
    }

    const head = await pocketRpcClient.getHeight()
    let signed: { signedPayload: string; transactionHash: string; timeoutTimestamp: Date }
    try {
      if (intent.kind === 'stake') {
        const stakeParams: StakeSupplierParams = { ...(p as StoredStakeParams), signerPrivateKey }
        // Never sign a stake naming an owner other than the one recorded for the key.
        if (key.stakeOwner && stakeParams.ownerAddress && stakeParams.ownerAddress !== key.stakeOwner) {
          log.error('signSupplierTx: stake owner differs from the recorded stake owner; abandoning', { transactionId, keyAddress: key.address })
          await dal.transactions.abandonIntent(transactionId, { message: 'sign failed: stake owner differs from the recorded stake owner' })
          return
        }
        signed = await pocketRpcClient.signSupplierTx(stakeParams)
      } else if (intent.kind === 'unstake') {
        // Provider-initiated unstake: combine unstake + optional drain into ONE operator-signed
        // tx (2 messages), mirroring the middleman stake+funds pattern. The drain amount is
        // computed now from the live spendable balance so the operator account lands at 0.
        // `owner` resolves to the recorded owner; `custom` is honoured only because this row
        // was written by the provider app (activities never store a custom destination).
        const dest = resolveDrainDestination(key, intent.returnFunds, null)
        if (intent.returnFunds?.mode === 'custom' && !dest) {
          await dal.transactions.abandonIntent(transactionId, { message: 'sign failed: invalid return-funds destination' })
          return
        }
        let drainTo: string | undefined
        let drainAmount: string | undefined
        if (dest) {
          const spendable = await pocketRpcClient.getSpendableBalance(key.address)
          const amt = spendable - RETURN_FUNDS_FEE_UPOKT
          if (amt > 0) {
            drainTo = dest
            drainAmount = String(amt)
          }
          // else: nothing meaningful to drain — unstake only.
        }
        signed = await pocketRpcClient.signUnstakeAndDrainTx({
          signerPrivateKey,
          operatorAddress: key.address,
          drainTo,
          drainAmount,
          feeUpoktOverride: drainTo ? RETURN_FUNDS_FEE_UPOKT : undefined,
        })
      } else {
        // return_funds: the destination must still be the key's recorded owner (the only
        // destination doCreateReturnFundsIntent writes).
        const sendParams = p as StoredSendFundsParams
        const owner = recordedOwnerOf(key)
        if (!owner || sendParams.toAddress !== owner || !isValidPoktAddress(sendParams.toAddress)) {
          log.error('signSupplierTx: return-funds destination is not the recorded owner; abandoning', { transactionId, keyAddress: key.address })
          await dal.transactions.abandonIntent(transactionId, { message: 'return-funds skipped: destination is not the recorded owner' })
          return
        }
        // compute exact drain amount NOW from live spendable balance.
        const spendable = await pocketRpcClient.getSpendableBalance(key.address)
        const feeUpokt = RETURN_FUNDS_FEE_UPOKT
        const sendAmount = spendable - feeUpokt
        if (sendAmount <= 0) {
          // Nothing meaningful to return — abandon this intent as a no-op success-equivalent.
          await dal.transactions.abandonIntent(transactionId, {
            message: `return-funds skipped: spendable ${spendable} <= fee ${feeUpokt}`,
          })
          return
        }
        signed = await pocketRpcClient.signSendTx(
          { ...sendParams, signerPrivateKey, amount: [{ denom: 'upokt', amount: String(sendAmount) }] },
          feeUpokt,
        )
      }
    } catch (err: any) {
      const msg: string = err?.message ?? String(err)
      if (msg.includes("does not exist on chain")) {
        // Signer account never funded — will never be signable. Abandon the intent
        // so the key's pending-unique index is freed for the next remediation cycle.
        await dal.transactions.abandonIntent(transactionId, {
          message: 'sign failed: signer account not found on chain',
        })
        return
      }
      throw err
    }
    await dal.transactions.recordSigned(transactionId, {
      signedPayload: signed.signedPayload,
      hash: signed.transactionHash,
      executionHeight: head,
      timeoutTimestamp: signed.timeoutTimestamp,
    })
  },

  /**
   * Child activity: broadcast the persisted signed bytes (idempotent re-broadcast).
   * A hard CheckTx rejection (res.rejected===true) → terminal failure immediately.
   * A RPC timeout or other transient failure (res.rejected===false/undefined) → do nothing;
   * the tx may still land on-chain and the verifier resolves it via chain-time bound.
   */
  async broadcastSupplierTx(transactionId: number): Promise<void> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn?.signedPayload) throw new Error(`broadcastSupplierTx: tx ${transactionId} missing signedPayload`)
    const res = await pocketRpcClient.broadcastSupplierTx(txn.signedPayload)
    if (res.rejected) {
      // Hard CheckTx reject (BroadcastTxError / non-zero code) — tx will never land.
      // Terminal failure; remediation re-detects on next sweep.
      await dal.transactions.claimTerminalTransition(transactionId, TransactionStatus.Failure, {
        code: res.code ?? undefined,
        message: res.message ?? 'broadcast rejected',
      })
    }
    // On timeout or other non-rejected failure: do nothing — verifier owns resolution.
  },

  /**
   * Returns true when the signed tx has expired per CHAIN block time (not wall-clock).
   * Uses getLatestBlockTime() so the comparison is chain-sourced, eliminating
   * clock-skew split-brain.
   */
  async isSignedTxExpired(transactionId: number): Promise<boolean> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn?.timeoutTimestamp) return false
    const chainTime = await pocketRpcClient.getLatestBlockTime()
    if (!chainTime) return false // RPC down → never declare expiry
    return chainTime.getTime() > txn.timeoutTimestamp.getTime()
  },

  /**
   * Clear the stale signed tx so the ExecuteTransaction child re-signs fresh (A3 re-sign branch).
   */
  async clearSignedTx(transactionId: number): Promise<void> {
    await dal.transactions.clearSigned(transactionId)
  },
  /**
   * Counts the number of keys in the database and return the min and max id.
   * @returns KeysMinMax
   */
  async getKeysMinAndMax(): Promise<KeysMinMax> {
    return dal.keys.getKeysMinAndMax()
  },

  /**
   * Loads a range of keys based on the specified parameters.
   *
   * @param {LoadKeysInRangeParams} params - The parameters containing the start and end identifiers for the key range.
   *                                          `params.afterId` defines the starting key (exclusive).
   *                                          `params.endId` defines the ending key (exclusive).
   * @return {Promise<LoadKeysInRangeResult>} A promise that resolves to the result of the loaded keys within the given range.
   */
  async loadKeysInRange(params: LoadKeysInRangeParams): Promise<LoadKeysInRangeResult> {
    return dal.keys.loadKeysInRange(params.minId, params.maxId, sanitizeKeyStates(params.states))
  },

  /**
   * Upserts the supplier status into the database.
   * @param params ProcessSupplierParams
   */
  async upsertSupplierStatus(params: ProcessSupplierParams): Promise<UpsertSupplierStatusResult> {
    log.info('upsertSupplierStatus: Querying for keys, settings, balance and supplier', {params})
    const [key, settings, balance, supplier, height]: [KeyWithGroup, ApplicationSettings, number, Supplier, number] = await Promise.all([
      dal.keys.loadKey(params.address),
      dal.settings.loadSettings(),
      pocketRpcClient.getBalance(params.address),
      pocketRpcClient.getSupplier(params.address),
      currentHeight(),
    ])

    if (!key) {
      throw new ApplicationFailure('key not found', 'not_found', true)
    }

    const prevState = key.state
    const prevRemediationReasons = (key.remediationHistory ?? []).map((rh) => rh.reason)

    const loggerContext = {
      key: key.address,
    }

    let ownerMismatch = false

    const update: Partial<InsertKey> = {
      lastUpdatedHeight: height, // always set the last updated height (chain-read).
      balanceUpokt: BigInt(balance), // always set the balance.
    }

    // if !supplier then is available only if the current state is different from available
    // if supplier and unstakeSessionEndHeight = 0 then is staked
    // if supplier and unstakeSessionEndHeight > 0 and unstakeSessionEndHeight < height then is unstaking
    // if supplier and unstakeSessionEndHeight > 0 and unstakeSessionEndHeight >= height then is unstaked

    // Determine the key state
    if (!supplier) {
      switch (key.state) {
        case KeyState.Imported:
          update.state = KeyState.Available
          break
        case KeyState.Unstaking:
          update.state = KeyState.Unstaked
          break
        case KeyState.Delivered:
        case KeyState.MissingStake:
          // If delivered/missing_stake for more than 24h with no supplier, release the key
          if (key.deliveredAt && key.deliveredAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
            update.state = KeyState.Available
            update.deliveredAt = null
            update.deliveredTo = null
            update.ownerAddress = null
            // Keep addressGroupId — key returns to its original group
            update.delegatorRevSharePercentage = 0
            update.delegatorRewardsAddress = ''
          } else {
            update.state = key.state
          }
          break;
        default:
          update.state = key.state
      }
    } else {
      const {ownerAddress, stake, unstakeSessionEndHeight, services, serviceConfigHistory} = supplier;

      // Supplier is present, determine state based on unstakeSessionEndHeight
      if (unstakeSessionEndHeight === 0) {
        update.state = KeyState.Staked;
      } else if (height >= unstakeSessionEndHeight) {
        update.state = KeyState.Unstaked;
      } else {
        update.state = KeyState.Unstaking;
      }

      // The stake owner is recorded once (first time it is seen) and never overwritten
      // by a later RPC read: it is the destination of every drain, so an owner change first
      // seen on the RPC (or a lying RPC) must not redirect funds. A mismatch is surfaced
      // (AttentionNeeded for a staked key) and blocks the automatic drain below until an
      // operator confirms the new owner.
      ownerMismatch = !!key.stakeOwner && !!ownerAddress && ownerAddress !== key.stakeOwner
      if (ownerMismatch) {
        log.error('upsertSupplierStatus: on-chain owner differs from the recorded stake owner; not updating it, drain blocked', {
          ...loggerContext,
          recordedStakeOwner: key.stakeOwner,
          chainOwner: ownerAddress,
        })
      }

      if (update.state === KeyState.Unstaking || update.state === KeyState.Staked) {
        if (!ownerMismatch) update.stakeOwner = ownerAddress
        update.stakeAmountUpokt = BigInt(stake ? stake.amount : '0')
        update.services = services || []

        if (key.state === KeyState.Imported || key.state === KeyState.Available) {
          // means the key is imported and is already staked, let's set it to the owner address
          update.ownerAddress = supplier.ownerAddress
        }

        // Backfill for legacy keys with empty owner address
        if (!key.ownerAddress && supplier.ownerAddress) {
          update.ownerAddress = supplier.ownerAddress
        }
      }

      log.debug('remediateSupplier: Checking if is owner initial stake remediation needed', {
        ...loggerContext,
        currentState: update.state,
        keyDelegatorAddress: key.delegatorRewardsAddress,
        services: supplier.services.length,
        servicesHistory: supplier.serviceConfigHistory?.length,
      })

      // --- NEW: cooldown / dedupe ---
      const existingOwnerInitialStake = (key.remediationHistory ?? []).find(
          (rh) => rh.reason === RemediationHistoryEntryReason.OwnerInitialStake
      )

      const now = Date.now()
      const cooldownMs = 10 * 60 * 1000 // 10 minutes; tune as you like
      const existingTs = existingOwnerInitialStake?.timestamp ?? 0
      const isInCooldown = existingOwnerInitialStake ? (now - existingTs) < cooldownMs : false

      const isOwnerInitialStakeRemediationNeeded =
        update.state === KeyState.Staked &&
        key.delegatorRewardsAddress && // We can only remediate if the key has a delegator rewards address
        supplier.services.length === 0 && // The supplier is staked without active services
          (supplier.serviceConfigHistory?.length ?? 0) === 0 // There are no pending activations or deactivations, this supplier is pristine

      if (isOwnerInitialStakeRemediationNeeded) {
        if (!isInCooldown) {
          update.remediationHistory = addOrUpdateRemediationHistory(
              {
                message: 'The supplier is not configured with any services.',
                reason: RemediationHistoryEntryReason.OwnerInitialStake,
                timestamp: Date.now(),
              },
              key.remediationHistory ?? []
          )
        } else {
          log.debug('upsertSupplierStatus: OwnerInitialStake detected but in cooldown; not updating remediation history.', {
            ...loggerContext,
            cooldownMs,
            existingTs,
          })
        }
      }

      log.debug('upsertSupplierStatus: Checking if is operational funds remediation needed', {
        ...loggerContext,
        currentState: update.state,
        balance: balance,
        minimumOperationalFunds: settings?.minimumOperationalFunds,
      })

      if (update.state === KeyState.Staked && balance && settings?.minimumOperationalFunds) {
        if (balance < settings?.minimumOperationalFunds) {
          update.remediationHistory = addOrUpdateRemediationHistory(
            {
              message: `The operational funds for this supplier (used to submit claim and proof transactions) are below the providers desired threshold (${settings?.minimumOperationalFunds} uPokt)`,
              reason: RemediationHistoryEntryReason.SupplierFundsTooLow,
              timestamp: Date.now(),
            },
            key.remediationHistory ?? []
          )
        }
      }

      log.debug('upsertSupplierStatus: Checking if is stake remediation needed', {
        ...loggerContext,
        currentState: update.state,
        stakeAmount: supplier.stake.amount,
        minimumStake: settings?.minimumStake,
      })

      if (update.state === KeyState.Staked && supplier.stake.amount && settings?.minimumStake) {
        const amount = parseInt(supplier.stake.amount, 10)
        if (amount < settings?.minimumStake) {
          update.remediationHistory = addOrUpdateRemediationHistory(
            {
              message: `The stake for this supplier is below the providers desired threshold (${settings?.minimumStake} uPokt)`,
              reason: RemediationHistoryEntryReason.SupplierStakeTooLow,
              timestamp: Date.now(),
            },
            key.remediationHistory ?? []
          )
        }
      }

      const hasAddressGroupMigrationPending = (key.remediationHistory ?? []).some(
        (rh) => rh.reason === RemediationHistoryEntryReason.AddressGroupMigration
      )

      if (!isOwnerInitialStakeRemediationNeeded && !hasAddressGroupMigrationPending && update.state === KeyState.Staked) {
        const expectedServices = getExpectedServicesFromKey(key)

        // only compare to the active services from the history, so if a service stake change is about to take place, we override it
        const activeServicesFromHistory = serviceConfigHistory?.filter((sc: ServiceConfigUpdate) => !sc.deactivationHeight && !!sc.service).map((sc: ServiceConfigUpdate) => sc.service) || []

        const compareHandler = new CompareSupplierServiceConfigHandler()
        const { isEqual: activeServicesEquals } = compareHandler.execute({
          serviceConfigSetA: activeServicesFromHistory,
          serviceConfigSetB: expectedServices,
        })

        if (!activeServicesEquals) {
          log.warn('upsertSupplierStatus: The key does not have the expected services configured in the service config history. Needs remediation.', {
            address: key.address,
            activeServicesFromHistory,
            expectedServices,
          })
          update.remediationHistory = addOrUpdateRemediationHistory(
            {
              message: 'The key does not have the expected services configured.',
              reason: RemediationHistoryEntryReason.ServiceMismatch,
              timestamp: Date.now(),
            },
            key.remediationHistory ?? []
          )
        } else {
          // Services match — clear any stale ServiceMismatch entry
          const currentHistory = update.remediationHistory ?? key.remediationHistory ?? []
          const hasStaleEntry = currentHistory.some((rh) => rh.reason === RemediationHistoryEntryReason.ServiceMismatch)
          if (hasStaleEntry) {
            log.info(`upsertSupplierStatus: The key ${key.address} services now match. Clearing stale ServiceMismatch entry.`)
            update.remediationHistory = currentHistory.filter((rh) => rh.reason !== RemediationHistoryEntryReason.ServiceMismatch)
          }
        }
      }

      const remediationReasons = update.remediationHistory?.map((rh) => rh.reason);

      log.debug('upsertSupplierStatus: Checking if is remediation needed', {
        ...loggerContext,
        remediationReasons,
      })

      // Only set the state to attention needed if the key is staked and the initial owner stake has been remediated. Otherwise, it will remain staked.
      if (
        remediationReasons?.length &&
        !remediationReasons.includes(RemediationHistoryEntryReason.OwnerInitialStake) &&
        !remediationReasons.includes(RemediationHistoryEntryReason.ServiceMismatch) &&
        !remediationReasons.includes(RemediationHistoryEntryReason.DelegatorAddressMissing) &&
        !remediationReasons.includes(RemediationHistoryEntryReason.AddressGroupMigration)
      ) {
        update.state = KeyState.AttentionNeeded
      }

      if (ownerMismatch && update.state === KeyState.Staked) {
        update.state = KeyState.AttentionNeeded
      }
    }

    log.debug('Updating supplier', { params, update })
    await dal.keys.updateKey(params.address, update, height)
    log.debug('Update Supplier done!', {params})

    // Drain trigger (D6): unbonding entered (Unstaking OR Unstaked) and not yet retired.
    // Fires for middleman-initiated unstakes (the provider has no INTENT for those, so no
    // applyVerificationDecision drain ran). Provider-UI unstakes already trigger the drain
    // from applyVerificationDecision; the pending-unique index + retiredAt guard inside
    // maybeCreateReturnFundsIntent make this duplicate path a structural no-op.
    if (
      (update.state === KeyState.Unstaking || update.state === KeyState.Unstaked) &&
      !key.retiredAt
    ) {
      if (ownerMismatch) {
        log.error('upsertSupplierStatus: automatic drain skipped, on-chain owner differs from the recorded stake owner; funds stay on the operator account', {
          key: key.address,
        })
      } else {
        // Destination decided from the PRE-update key snapshot (the owner recorded before
        // this sweep), never from an owner this same sweep just read from the RPC.
        await maybeCreateReturnFundsIntent(key) // no explicit choice -> obey settings flag
      }
      // Retire-on-unbonding (set-once, isNull guard): retire the key the moment it enters
      // unbonding — NOT only at the terminal Unstaked state. This closes the no-double-drain
      // gap on this automatic path: the pending-unique index only blocks a CONCURRENT pending
      // drain, so without retiring here, every SupplierStatus sweep across the multi-minute
      // Unstaking window re-fired maybeCreateReturnFundsIntent; once the first drain SUCCEEDED
      // (no longer pending) the next sweep created a second drain that then failed with
      // "spendable 0 <= fee". Setting retiredAt now makes the next sweep's !key.retiredAt skip.
      await dal.keys.setRetiredAt(key.address)
    }

    // Retire-on-terminal: safety net for a key that reaches Unstaked while already retired
    // by another path (e.g. the provider-UI unstake-tx success effect in flipKeyForTx).
    // setRetiredAt is set-once (isNull(retiredAt) guard), so this is idempotent.
    if (update.state === KeyState.Unstaked) {
      await dal.keys.setRetiredAt(key.address)
    }

    const currentState = update.state ?? prevState
    const currentRemediationReasons = (update.remediationHistory ?? key.remediationHistory ?? []).map((rh) => rh.reason)

    // Stake completion: a supplier is only "fully staked" once it is bonded AND has at
    // least one service configured. Services are written a sweep after the bare bond, so
    // we flag completion on exactly the sweep where both conditions first hold (i.e. they
    // did not hold last sweep). This is what the "Suppliers Staked" notification keys off.
    const prevServiceCount = key.services?.length ?? 0
    const currentServiceCount = (update.services ?? key.services)?.length ?? 0
    // "Was already a configured supplier" includes the degraded states a staked supplier
    // can sit in (AttentionNeeded / RemediationFailed) — otherwise a drift→recovery back to
    // Staked would falsely re-fire "Suppliers Staked". Only a genuinely-not-yet-staked
    // supplier reaching Staked-with-services counts as a completion.
    const STAKED_FAMILY = [KeyState.Staked, KeyState.AttentionNeeded, KeyState.RemediationFailed]
    // States a key passes through while WE stake it, so reaching Staked-with-services is a
    // genuine completion — plus the bare-bond case (already Staked with 0 services, services
    // now landing). Excludes Imported: an Imported→Staked jump is the provider DISCOVERING a
    // key already staked on-chain (e.g. importing pre-staked keys), not a fresh completion,
    // so it must not fire "Suppliers Staked".
    const STAKING_FLOW_STATES = [
      KeyState.Available, KeyState.Delivered, KeyState.Staking,
      KeyState.MissingStake, KeyState.Unstaked, KeyState.Unstaking,
    ]
    const wasFullyStaked = STAKED_FAMILY.includes(prevState) && prevServiceCount > 0
    const isFullyStaked = currentState === KeyState.Staked && currentServiceCount > 0
    const fromStakeCompletionPath =
      STAKING_FLOW_STATES.includes(prevState) ||
      (prevState === KeyState.Staked && prevServiceCount === 0)
    const becameFullyStaked = isFullyStaked && !wasFullyStaked && fromStakeCompletionPath

    const result: UpsertSupplierStatusResult = {
      state: currentState,
      remediationReasons: currentRemediationReasons,
      becameFullyStaked,
    }

    const prevDiff: UpsertSupplierStatusResult['prev'] = {}
    if (prevState !== currentState) {
      prevDiff.state = prevState
    }

    const addedReasons = currentRemediationReasons.filter((r) => !prevRemediationReasons.includes(r))
    const removedReasons = prevRemediationReasons.filter((r) => !currentRemediationReasons.includes(r))
    if (addedReasons.length || removedReasons.length) {
      prevDiff.remediationReasons = prevRemediationReasons
    }

    if (Object.keys(prevDiff).length) {
      result.prev = prevDiff
    }

    result.supplier = supplier

    return result
  },

  /**
   * Remediates the supplier by checking if remediation is required and performing necessary actions,
   * including staking and updating the supplier's state.
   *
   * @param {RemediateSupplierParams} params - The parameters required to remediate the supplier, including
   * the supplier's address, remediation reasons, and relevant height.
   * @return {Promise<{success: boolean, message: string}>} An object indicating the success or failure of the remediation process
   * and an accompanying message.
   */
  async remediateSupplier(params: RemediateSupplierParams) {
    log.debug('remediateSupplier: Execution started', {params})
    const [key, supportedServices, balance, supplier, height]: [KeyWithGroup, Service[], number, Supplier, number] = await Promise.all([
      dal.keys.loadKey(params.address),
      dal.services.loadServices(),
      pocketRpcClient.getBalance(params.address),
      pocketRpcClient.getSupplier(params.address),
      currentHeight(),
    ])

    if (!key) {
      log.warn('remediateSupplier: Key not found', {params})
      throw ApplicationFailure.nonRetryable('Key not found', 'not_found')
    }

    // D7: never re-stake a retired (unstaked) key
    if (key.retiredAt) {
      log.info('remediateSupplier: Key is retired (retiredAt set); skipping remediation', {params})
      return {
        success: true,
        message: 'Key is retired — re-staking is not allowed.',
      }
    }

    if (!key.addressGroup) {
      log.warn('remediateSupplier: Address Group not found', {params})
      throw ApplicationFailure.nonRetryable('Key address group not found', 'not_found')
    }

    if (!supplier) {
      log.info('remediateSupplier: Supplier not found on-chain, skipping remediation', {params})
      return {
        success: true,
        remediated: false,
        message: 'Supplier not found on-chain — nothing to remediate.'
      }
    }

    if (key.remediationHistory?.length === 0) {
      log.debug('remediateSupplier: No remediation history found. Nothing to do here. Bye!', {params})
      return {
        success: true,
        remediated: false,
        message: 'No remediation history found.'
      }
    }

    log.debug('remediateSupplier: Loaded key, supportedServices, balance and supplier', {
      key: {
        address: key.address,
        ownerAddress: key?.ownerAddress,
        state: key.state,
        balance: Number(balance),
      },
      supportedServices: supportedServices.map((s) => ({
        id: s.serviceId,
        name: s.name,
      })),
      supportedServicesCount: supportedServices.length,
      supplier: {
        ownerAddress: supplier?.ownerAddress,
        operatorAddress: supplier?.operatorAddress,
        stake: supplier?.stake,
        services: supplier?.services?.length,
        unstakeSessionEndHeight: supplier?.unstakeSessionEndHeight,
        serviceConfigHistory: supplier?.serviceConfigHistory?.length,
      }
    })

    // --- Determine what we can actually remediate ---
    // `reasons` comes from the workflow input. Only the remediable reasons are
    // honoured, and each one still needs a matching entry in the key's own (server-written)
    // remediation history below, so the input can only narrow what runs, never widen it.
    params = { ...params, reasons: sanitizeRemediationReasons(params.reasons) }
    const remediationHistory = key.remediationHistory ?? [];
    const hasOwnerInitialStakeReason = params.reasons.includes(RemediationHistoryEntryReason.OwnerInitialStake);

    const ownerInitialStakeEntry = hasOwnerInitialStakeReason
        ? remediationHistory.find((rh) => rh.reason === RemediationHistoryEntryReason.OwnerInitialStake) ?? null
        : null

    const hasServiceMismatchReason = params.reasons.includes(RemediationHistoryEntryReason.ServiceMismatch);

    const serviceMismatchEntry = hasServiceMismatchReason
      ? remediationHistory.find((rh) => rh.reason === RemediationHistoryEntryReason.ServiceMismatch) ?? null
      : null

    const hasAddressGroupMigrationReason = params.reasons.includes(RemediationHistoryEntryReason.AddressGroupMigration);

    const addressGroupMigrationEntry = hasAddressGroupMigrationReason
      ? remediationHistory.find((rh) => rh.reason === RemediationHistoryEntryReason.AddressGroupMigration) ?? null
      : null

    // Nothing actionable? DO NOT stake.
    if (!ownerInitialStakeEntry && !serviceMismatchEntry && !addressGroupMigrationEntry) {
      log.info('remediateSupplier: No actionable remediation in reasons. Skipping stake.', {
        params,
        reasons: params.reasons,
      })
      return {
        success: true,
        remediated: false,
        message: 'No actionable remediation for this supplier.',
      }
    }

    if (ownerInitialStakeEntry) {
      // If supplier already has services or has config history, OwnerInitialStake is no longer valid.
      const supplierAlreadyConfigured =
        (supplier.services?.length ?? 0) > 0 || (supplier.serviceConfigHistory?.length ?? 0) > 0

      if (supplierAlreadyConfigured) {
        log.info('remediateSupplier: Supplier already configured; clearing OwnerInitialStake entry without staking.', {
          params,
          services: supplier.services?.length ?? 0,
          servicesHistory: supplier.serviceConfigHistory?.length ?? 0,
        })

        const update: Partial<InsertKey> = {
          lastUpdatedHeight: height,
          balanceUpokt: BigInt(balance),
          // remove only OwnerInitialStake entry; keep other entries if any
          remediationHistory: remediationHistory.filter((rh) => rh.reason !== RemediationHistoryEntryReason.OwnerInitialStake),
        }

        try {
          await dal.keys.updateKey(params.address, update, height)
        } catch (e) {
          log.warn('remediateSupplier: Update Supplier failed while clearing OwnerInitialStake!', {
            params,
            error: errInfo(e),
          })
          throw ApplicationFailure.retryable(
            `Failed while updating the supplier status for ${params.address}.`,
            'db_update_failed',
          )
        }

        // No on-chain action was taken — this only clears a stale OwnerInitialStake flag.
        // remediated:false so a no-op sweep does not surface a "1 succeeded" notification
        // (notify only when a real remediation action occurred). appliedReasons is kept so
        // remediateSupplier's return union stays stable for the range aggregator's type; it is
        // never read for a remediated:false result (the aggregator gates on remediated === true).
        return { success: true, remediated: false, appliedReasons: [RemediationHistoryEntryReason.OwnerInitialStake], message: 'Supplier already configured; nothing remediated (cleared stale OwnerInitialStake flag).' }
      }
    }

    // The owner comes from chain here; never act on an owner other than the one
    // recorded for this key (an owner change first seen on the RPC needs confirmation).
    if (key.stakeOwner && supplier.ownerAddress !== key.stakeOwner) {
      log.warn('remediateSupplier: on-chain owner differs from the recorded stake owner; refusing to stake', {
        address: params.address,
      })
      return {
        success: true,
        remediated: false,
        message: 'On-chain owner differs from the recorded stake owner; remediation needs operator confirmation.',
      }
    }

    const stakeParams: StoredStakeParams = {
      signer: key.address,
      ownerAddress: supplier.ownerAddress,
      operatorAddress: key.address,
    }

    log.debug('remediateSupplier: Preparing initial owner stake remediation', {
      entry: ownerInitialStakeEntry || serviceMismatchEntry,
    })

    const buildSupplierServiceConfigHandler = new BuildSupplierServiceConfigHandler()
    stakeParams.services = buildSupplierServiceConfigHandler.execute({
      services: supportedServices,
      addressGroup: key.addressGroup,
      ownerAddress: supplier.ownerAddress,
      operatorAddress: key.address,
      requestRevShare: [{
        revSharePercentage: key.delegatorRevSharePercentage ?? 0,
        address: key.delegatorRewardsAddress ?? '',
      }]
    })

    if (!stakeParams.services || stakeParams.services.length === 0) {
      log.warn('remediateSupplier: Refusing to stake because computed services is empty', {
        params,
        supportedServicesCount: supportedServices.length,
        addressGroup: key.addressGroup?.id ?? 'unknown',
      })
      throw ApplicationFailure.nonRetryable(
        `Refusing to stake with empty services config for ${params.address}.`,
        'empty_services',
      )
    }

    log.debug('remediateSupplier: Building stake intent', {
      stakeParams: redactStakeSupplierParams({ ...stakeParams, services: stakeParams.services ?? [] }),
      servicesToStakeCount: stakeParams.services.length,
    })

    const reasons = [ownerInitialStakeEntry, serviceMismatchEntry, addressGroupMigrationEntry]
      .filter(Boolean).map((e) => e!.reason)
    const created = await createStakeIntent({ keyAddress: key.address, reasons, params: stakeParams })
    if (created === null) {
      log.info('remediateSupplier: pending tx already exists for key, skipping', { address: params.address })
      return
    }
    log.info('remediateSupplier: INTENT created; dispatcher will broadcast+verify', { address: params.address, txId: created })
    return { success: true, message: 'Stake intent recorded; pending broadcast.' }
  },

  /**
   * The verifier's queue: pending transactions that have been broadcast (have a hash).
   */
  async listPendingWithHash() {
    const txs = await dal.transactions.listPendingWithHash()
    return txs.map(({ id, executionHeight }) => ({ id, executionHeight }))
  },

  /**
   * Verifies a broadcast tx by hash, scanning from one block past its last covered
   * height (or its execution height on the first sweep). Maps the pocket tri-state
   * result down to the minimal shape the pure decision logic consumes.
   *
   * Provider txs are unordered: maxBlocks=12 (spec decision-6). The absent result
   * now carries coveredBlockTime (chain block time at coveredUpToHeight) so callers
   * can supply chainTimeAtCoverage to decideVerification without a wall-clock.
   */
  async verifyTxHash(transactionId: number): Promise<VerifyOutcome<{ success: boolean; code: number; gasUsed: string; rawLog?: string }> & { chainTimeAtCoverage?: Date | null }> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn?.hash) {
      throw new Error('verifyTxHash: tx missing hash')
    }
    const startHeight = txn.lastCoveredHeight != null ? txn.lastCoveredHeight + 1 : (txn.executionHeight ?? 0)
    const out = await pocketRpcClient.verifyTransaction(txn.hash, startHeight, 12)
    if (out.status === 'absent') {
      return { ...out, chainTimeAtCoverage: out.coveredBlockTime ?? null }
    }
    if (out.status !== 'confirmed') return out
    // gasUsed serialized as a string: a bigint cannot cross the Temporal activity
    // boundary (default payload converter cannot encode BigInt).
    return {
      status: 'confirmed',
      data: { success: out.data.success, code: out.data.code, gasUsed: out.data.gasUsed.toString(), rawLog: out.data.rawLog },
    }
  },

  /**
   * Verifies a broadcast tx by its expected on-chain supplier goal-state. Returns null for
   * tx types with no supplier-state path (e.g. ServiceMismatch/AddressGroupMigration stake txs,
   * or non-supplier tx types) so the decision logic treats the supplier path as inapplicable.
   * Maps pocket's tri-state result into SupplierPathOutcome for decide v2.
   */
  async verifySupplierEffect(transactionId: number): Promise<import('@igniter/tx-verify').SupplierPathOutcome | null> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn) {
      throw new Error('verifySupplierEffect: tx not found')
    }
    const key = await dal.keys.loadKey(txn.keyAddress)
    if (!key) {
      // Key removed mid-flight (deterministic — never recovers). Do NOT throw: a throw here
      // rejects this tx in the sweep, and a sweep where every tx rejects makes
      // VerifyPendingTransactions fail, which under ScheduleOverlapPolicy.SKIP would stall
      // all future sweeps. Returning null routes the decision to the hash + timeout bound
      // (→ success if the hash landed, else a clean failure once the timeout passes).
      log.warn(`verifySupplierEffect: key not found for tx ${transactionId} (${txn.keyAddress}); falling back to hash-only verification`)
      return null
    }
    const parsed = supplierEffectFromKey(txn, key)
    if (!parsed) return null

    // OwnerInitialStake: deep-compare intended vs on-chain service config rather than
    // checking mere presence (services.length > 0). A supplier with stale services from
    // a prior stake would satisfy the weak check; this ensures the INTENDED config applied.
    if (parsed.effect.kind === 'stake-services-present') {
      let supplier: import('@igniter/pocket').Supplier | null
      try {
        supplier = await pocketRpcClient.getSupplier(parsed.operatorAddress)
      } catch {
        return { status: 'unavailable' }
      }
      if (!supplier || supplier.ownerAddress !== parsed.effect.ownerAddress) {
        return { status: 'absent', absentOperators: [parsed.operatorAddress] }
      }
      const intended = getExpectedServicesFromKey(key)
      const compare = new CompareSupplierServiceConfigHandler()
      // Check active services
      const activeMatch = compare.execute({
        serviceConfigSetA: intended,
        serviceConfigSetB: supplier.services ?? [],
      }).isEqual
      if (activeMatch) return { status: 'confirmed' }
      // Check pending activation entries in serviceConfigHistory
      const pendingMatch = (supplier.serviceConfigHistory ?? []).some((entry: ServiceConfigUpdate) => {
        if (!entry.service) return false
        return compare.execute({
          serviceConfigSetA: intended,
          serviceConfigSetB: [entry.service],
        }).isEqual
      })
      if (pendingMatch) return { status: 'confirmed' }
      return { status: 'absent', absentOperators: [parsed.operatorAddress] }
    }

    const out = await pocketRpcClient.verifySupplierEffect(parsed.operatorAddress, parsed.effect)
    if (out.status === 'confirmed') return { status: 'confirmed' }
    if (out.status === 'absent') return { status: 'absent', absentOperators: [parsed.operatorAddress] }
    return { status: 'unavailable' }
  },

  /**
   * Failure-bound evidence for a provider tx. Provider txs are now UNORDERED:
   * the failure bound is chain-block-time vs txTimeoutTimestamp (not height).
   * chainTimeAtCoverage is passed in from the verifyTxHash result to avoid a
   * separate RPC call and to keep the comparison to chain time (not wall-clock).
   */
  async checkTxValidityEvidence(transactionId: number, chainTimeAtCoverage?: Date | null): Promise<{
    txTimeoutHeight: number | null
    txTimeoutTimestamp: Date | null
    sequence: { consumed: boolean; observedAtHeight: number } | null
    chainTimeAtCoverage: Date | null
  }> {
    const txn = await dal.transactions.getTransaction(transactionId)
    return {
      txTimeoutHeight: null,
      txTimeoutTimestamp: txn?.timeoutTimestamp ?? null,
      sequence: null,
      chainTimeAtCoverage: chainTimeAtCoverage ?? null,
    }
  },

  /**
   * Applies a verification decision computed by the pure `decideVerification` (v2 shape).
   * Pending → record progress (coverage/unavailable decay) + maybe alert on chronic unavailability.
   * Terminal → run the provider key-state effect FIRST (keyed off goal-state effects, not tx outcome),
   * then atomically CAS the tx to its terminal status. Effects-before-CAS so a failure mid-effect
   * re-sweeps and re-runs the idempotent effect instead of losing it to a lost CAS.
   */
  async applyVerificationDecision(transactionId: number, decision: VerificationDecision): Promise<void> {
    if (decision.tx === 'pending') {
      await dal.transactions.recordVerificationProgress(transactionId, {
        lastCoveredHeight: decision.newLastCoveredHeight,
        incUnavailable: decision.incUnavailable,
      })
      if (decision.incUnavailable) await maybeAlertUnavailable(transactionId)
      return
    }

    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn) return

    // Effects keyed off GOAL-STATE, not tx outcome: a tx that failed on-chain while a
    // sibling achieved the goal must NOT drag the key to RemediationFailed.
    if (decision.effects !== 'none') {
      await flipKeyForTx(txn, decision.effects)
    }

    const status = decision.tx === 'success' ? TransactionStatus.Success : TransactionStatus.Failure
    // Failure message: prefer the chain's own error text (rawLog, present when the tx
    // was found on-chain and failed) so the UI can show the real reason; the hardcoded
    // summaries remain for paths with no chain text (absent-tx failure) or as suffix
    // context (sibling-met goal).
    const claimed = await dal.transactions.claimTerminalTransition(transactionId, status, {
      code: decision.code,
      message: decision.tx === 'success' ? 'verified'
        : decision.effects === 'apply-success'
          ? `tx failed on-chain; goal met by sibling tx${decision.rawLog ? ` (${decision.rawLog})` : ''}`
          : decision.rawLog || 'verification negative (validity bound covered, no effect)',
    })

    // Provider-UI drain path: an Unstake verified success kicks off the drain using the
    // per-op returnFunds choice frozen in the unstake intent.
    //
    // Created AFTER the terminal CAS (not before) for two reasons:
    //   1. The pending-unique index UNIQUE(key_id) WHERE pending would BLOCK the drain
    //      intent while the unstake row is still pending; only once the unstake reaches
    //      its terminal status is the per-key pending slot free for the drain row.
    //   2. `claimed` is truthy only for the single call that actually performed the
    //      transition (CAS), so the drain is created exactly once — an overlapping sweep
    //      or re-sweep gets undefined and never re-enters here.
    // NOTE: provider-initiated unstakes carry the drain INSIDE the unstake tx (signUnstakeAndDrainTx),
    // so there is NO separate ReturnFunds intent to create here. The middleman path's drain is
    // triggered separately in upsertSupplierStatus when it observes the on-chain unbonding.

    // D10: after a ReturnFunds tx succeeds, warn if a residual balance remains above dust tolerance.
    // Observability only — never blocks or retries.
    if (claimed && decision.tx === 'success' && txn.type === TransactionType.ReturnFunds) {
      try {
        const residual = await pocketRpcClient.getSpendableBalance(txn.keyAddress)
        if (residual > DRAIN_DUST_TOLERANCE_UPOKT) {
          log.warn('return-funds: residual balance remains after drain', {
            keyAddress: txn.keyAddress,
            residual,
          })
        }
      } catch {
        // Balance read failed — ignore; this is observability only.
      }
    }
  },

  async sendNotifications(event: NotificationEvent): Promise<void> {
    try {
      const allChannels = await dal.notificationChannels.loadEnabledChannels()

      const channels = allChannels.filter((c) => {
        const flags = { ...DEFAULT_NOTIFICATION_FLAGS, ...(c.notificationFlags ?? {}) }
        return flags[event.type] ?? false
      })

      if (channels.length === 0) {
        log.debug('sendNotifications: No enabled channels subscribed to this event type, skipping', { type: event.type })
        return
      }

      const smtpConfig = channels.some((c) => c.type === NotificationChannelType.Email)
        ? await dal.notificationChannels.loadSmtpConfig()
        : null

      // Pre-generate UUID so the message link can be built before saving to DB
      const uuid = randomUUID()

      const providerAppUrl = process.env.PROVIDER_APP_URL?.replace(/\/$/, '')
      let providerName: string | null = null
      try {
        providerName = (await dal.settings.loadSettings())?.name ?? null
      } catch (e) {
        log.warn('sendNotifications: Failed to load settings for provider name, continuing without it', { e })
      }
      const richMessage = buildRichMessage(event, uuid, providerAppUrl, providerName)

      // Single-owner provider: all email channels share one SMTP server. Resolve
      // it into each email channel's config and record an error for any email
      // channel when SMTP is unconfigured (Discord/Telegram pass through). The
      // shared dispatch helper then sends to every channel and reports status.
      const emailSmtp = smtpConfig
        ? {
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure,
            username: smtpConfig.username,
            password: smtpConfig.password,
            fromAddress: smtpConfig.fromAddress,
            fromName: smtpConfig.fromName ?? undefined,
          }
        : null

      const channelResults: ChannelDeliveryResult[] = []
      const dispatchable: DispatchChannel[] = []
      for (const channel of channels) {
        if (channel.type === NotificationChannelType.Email) {
          if (!emailSmtp) {
            channelResults.push({ id: channel.id, name: channel.name, type: 'email', status: 'error', error: 'SMTP configuration not found' })
            continue
          }
          const config = channel.config as { to: string[]; cc?: string[]; bcc?: string[] }
          dispatchable.push({ id: channel.id, name: channel.name, type: 'email', config: { ...config, smtp: emailSmtp } })
        } else {
          dispatchable.push({ id: channel.id, name: channel.name, type: channel.type as 'discord' | 'telegram', config: channel.config as DispatchChannel['config'] })
        }
      }

      // Build a single pooled transport once and reuse it across the run — one
      // TCP+TLS+AUTH handshake instead of one per channel. Closed in the finally.
      const emailTransporter =
        emailSmtp && dispatchable.some((c) => c.type === 'email')
          ? createSmtpTransport(emailSmtp, { pool: true })
          : null

      try {
        const delivered = await dispatchToChannels(dispatchable, richMessage, {
          emailTransporter: emailTransporter ?? undefined,
        })
        channelResults.push(...delivered)
      } finally {
        emailTransporter?.close()
      }

      for (const r of channelResults) {
        if (r.status === 'error') {
          log.warn('sendNotifications: Channel delivery failed', { channelId: r.id, channelType: r.type, error: r.error })
        }
      }

      // Save event with per-channel delivery status
      try {
        await dal.notificationChannels.insertNotificationEvent({
          uuid,
          type: event.type,
          metadata: event.metadata,
          channels: channelResults,
        })
      } catch (dbErr) {
        log.error('sendNotifications: Failed to save notification event to DB', { dbErr, type: event.type })
      }

      const errorCount = channelResults.filter((r) => r.status === 'error').length
      log.info('sendNotifications: Done', { type: event.type, uuid, total: channelResults.length, errors: errorCount })
    } catch (err) {
      log.error('sendNotifications: Unexpected error — notifications skipped', { err, type: event.type })
    }
  },
  }

  /**
   * Builds the frozen stake params + creates the INTENT row (formerly the createIntentTx
   * activity; now internal, so it is never scheduled with caller-chosen params).
   * Returns the new tx id, or null if a pending row already exists for this key
   * (the (key_id) WHERE pending unique index enforces mutual exclusion).
   */
  async function createStakeIntent(p: { keyAddress: string; reasons: RemediationHistoryEntryReason[]; params: StoredStakeParams }): Promise<number | null> {
    const key = await dal.keys.loadKey(p.keyAddress)
    if (!key) throw ApplicationFailure.nonRetryable(`createIntentTx: key not found for ${p.keyAddress}`, 'not_found')
    return dal.transactions.createIntent({
      keyId: key.id,
      keyAddress: key.address,
      type: TransactionType.Stake,
      reason: p.reasons[0] ?? null,
      trigger: TransactionTrigger.Automatic,
      executionHeight: null,
      params: JSON.stringify({ kind: 'stake', params: withoutSignerKey(p.params) } satisfies TxIntentParams),
      reasons: JSON.stringify(p.reasons),
    })
  }

  /**
   * Provider terminal effect: flips the key state per the verified tx TYPE.
   * Keyed off goal-state effects (not raw tx outcome) so a tx that failed on-chain
   * while a sibling achieved the goal still reaches its goal state.
   *
   *  - Stake:       success → Staked, failure → RemediationFailed. State-CAS: keys that
   *                 moved to Unstaking/Unstaked/AttentionNeeded since broadcast must NOT
   *                 be dragged back — those transitions take priority.
   *  - Unstake:     success → Unstaking + retire (set-once); the terminal Unstaked state
   *                 is reconciled from chain by upsertSupplierStatus. failure → AttentionNeeded
   *                 (do NOT retire — operator may re-try).
   *  - ReturnFunds: NEVER mutate key state (it's a bank send; key lifecycle is independent).
   */
  async function flipKeyForTx(
    txn: Transaction,
    effects: 'apply-success' | 'apply-failure',
  ): Promise<void> {
    if (txn.type === TransactionType.Stake) {
      const blockedStates = [KeyState.Unstaking, KeyState.Unstaked, KeyState.AttentionNeeded]
      const flipped = effects === 'apply-success'
        ? await dal.keys.flipState(txn.keyAddress, KeyState.Staked, { notFromStates: blockedStates, removeEntryReason: txn.reason ?? undefined })
        : await dal.keys.flipState(txn.keyAddress, KeyState.RemediationFailed, { notFromStates: blockedStates })
      if (!flipped) {
        log.info('flipKeyForTx: key state moved on since broadcast; flip skipped', { keyAddress: txn.keyAddress, effects })
      }
      return
    }

    if (txn.type === TransactionType.Unstake) {
      if (effects === 'apply-success') {
        // Unstake landed on-chain (unbonding entered). Mark Unstaking and RETIRE (set-once).
        // Final Unstaked state is reconciled by upsertSupplierStatus from chain.
        const flipped = await dal.keys.flipState(txn.keyAddress, KeyState.Unstaking, {
          notFromStates: [KeyState.Unstaked],
        })
        if (!flipped) {
          log.info('flipKeyForTx: key already past Unstaking since broadcast; flip skipped', { keyAddress: txn.keyAddress })
        }
        await dal.keys.setRetiredAt(txn.keyAddress)
      } else {
        // Unstake failed on-chain: surface for attention, do not retire.
        const flipped = await dal.keys.flipState(txn.keyAddress, KeyState.AttentionNeeded, {
          notFromStates: [KeyState.Unstaking, KeyState.Unstaked],
        })
        if (!flipped) {
          log.info('flipKeyForTx: key already unbonding since broadcast; AttentionNeeded flip skipped', { keyAddress: txn.keyAddress })
        }
      }
      return
    }

    // ReturnFunds: a bank send. NEVER mutate key state on success or failure.
    // (supplierEffectFromKey returns null for it, so the verifier resolves it hash-only;
    //  whatever the effect, the key's lifecycle state is independent of a drain send.)
  }

  /**
   * Drain (return-funds) intent for the middleman/automatic path (upsertSupplierStatus, no
   * explicit choice → settings flag). Provider-UI unstakes carry their drain inside the
   * unstake tx itself (signUnstakeAndDrainTx), so they never come through here.
   *
   * No-double-drain / idempotency is structural:
   *  - pending-unique index: doCreateReturnFundsIntent → createIntent uses onConflictDoNothing
   *    on the partial UNIQUE(key_id) WHERE pending index, so a key that already has a pending
   *    tx (including a pending drain) can never get a SECOND pending drain.
   *  - retire guard: a key with `retiredAt` set never re-drains from the repeated
   *    chain-detection sweeps.
   *
   * resolveDrainDestination is the pure decision; this wrapper only does the DAL I/O.
   */
  async function maybeCreateReturnFundsIntent(
    key: { address: string; stakeOwner?: string | null; ownerAddress?: string | null; retiredAt?: Date | null },
  ): Promise<void> {
    // Automatic path only (no explicit choice): obey the retire guard so the repeated
    // chain-detection sweeps never re-drain, then obey the settings flag. `key` is the
    // snapshot loaded BEFORE this sweep's update (recorded owner only).
    if (key.retiredAt) return
    const settings = await dal.settings.loadSettings()

    const toAddress = resolveDrainDestination(key, undefined, settings)
    if (!toAddress) return
    if (!isValidPoktAddress(toAddress)) {
      // Never fail the status sweep over it (that would also skip setRetiredAt): log and skip.
      log.error('maybeCreateReturnFundsIntent: recorded owner is not a valid pokt address; automatic drain skipped', { key: key.address })
      return
    }

    await doCreateReturnFundsIntent(dal, key.address, toAddress)
  }

  /**
   * Reads the tx and emits a critical log when its unavailable-check counter crosses a
   * multiple of the alert threshold. No status change — operator-attention only.
   */
  async function maybeAlertUnavailable(transactionId: number): Promise<void> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (txn && txn.unavailableChecks > 0 && txn.unavailableChecks % VERIFY_UNAVAILABLE_ALERT_THRESHOLD === 0) {
      log.error(
        'TX unverifiable: RPC repeatedly unavailable — operator attention needed',
        { transactionId, unavailableChecks: txn.unavailableChecks },
      )
    }
  }

  return activities
}
