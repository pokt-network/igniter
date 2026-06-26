import type { Transaction } from '@igniter/db/provider/schema'
import { TransactionStatus, TransactionType } from '@igniter/db/provider/enums'

/**
 * Provider-side mirror of the middleman derivePendingState. The provider transactions
 * table has NO unsignedPayload + NO provider relation, and at most ONE pending tx per key
 * (transactions_key_pending_uq), so we derive directly off the row's `type` / `keyAddress`
 * / `status` rather than parsing a signed payload. Stake amount / op funds are not stored on
 * provider transactions, so those are always null (rendered as "—" client-side).
 *
 * Domain type carries Date; the *Serialized variant carries ISO strings — the server-action
 * boundary serializes Date -> ISO string and keeps any amounts as strings (never bigint),
 * mirroring the middleman serialization contract.
 */

export type PendingOpKind = 'stake' | 'unstake' | 'return_funds'
export type PendingOpStatus = 'pending' | 'success' | 'failure'

export type PendingOperation = {
  kind: PendingOpKind
  status: PendingOpStatus
  keyAddress: string
  hash: string | null
  createdAt: Date | null
}

export type PendingState = {
  // PENDING-only guard: keyAddress -> kind. Settled rows must NOT populate this so a
  // just-settled tx doesn't keep gating action buttons.
  byKey: Record<string, PendingOpKind>
  // Both pending AND recently-settled rows (status carried through).
  pendingOperations: Array<PendingOperation>
}

export type PendingOperationSerialized = {
  kind: PendingOpKind
  status: PendingOpStatus
  keyAddress: string
  hash: string | null
  createdAt: string | null
}

export type PendingStateSerialized = {
  byKey: Record<string, PendingOpKind>
  pendingOperations: Array<PendingOperationSerialized>
}

function mapType(type: string): PendingOpKind {
  if (type === TransactionType.Unstake) return 'unstake'
  if (type === TransactionType.ReturnFunds) return 'return_funds'
  return 'stake'
}

function mapStatus(status: string): PendingOpStatus {
  if (status === TransactionStatus.Success) return 'success'
  if (status === TransactionStatus.Failure) return 'failure'
  return 'pending'
}

// Unstake / return_funds outrank stake when deduping a key (the more "destructive"
// lifecycle op is what the operator cares about seeing in progress).
function rank(kind: PendingOpKind): number {
  if (kind === 'unstake') return 2
  if (kind === 'return_funds') return 2
  return 1
}

// Representative op per key when several rows fall in the linger window: an IN-FLIGHT
// (pending) op always wins over a settled one (it's what the operator is waiting on),
// then the more "destructive" kind, then — since rows arrive newest-first — ties keep the
// newer row (handled by a strict `>` comparison at the call site).
function priority(op: PendingOperation): number {
  return (op.status === 'pending' ? 100 : 0) + rank(op.kind)
}

export function derivePendingState(txs: Transaction[]): PendingState {
  const byKey: Record<string, PendingOpKind> = {}
  const opsMap = new Map<string, PendingOperation>()

  for (const tx of txs) {
    const kind = mapType(tx.type)
    const status = mapStatus(tx.status)
    const isPending = status === 'pending'

    // byKey guard is pending-only.
    if (isPending) {
      byKey[tx.keyAddress] = kind
    }

    const op: PendingOperation = {
      kind,
      status,
      keyAddress: tx.keyAddress,
      hash: tx.hash ?? null,
      createdAt: tx.createdAt ?? null,
    }

    // Strict `>`: rows are newest-first, so an equal-priority older row never displaces
    // the newer one already stored. Pending beats settled even when the settled row has a
    // higher kind-rank, so the visible status can't contradict the pending badge count.
    const existing = opsMap.get(tx.keyAddress)
    if (!existing || priority(op) > priority(existing)) {
      opsMap.set(tx.keyAddress, op)
    }
  }

  return { byKey, pendingOperations: Array.from(opsMap.values()) }
}
