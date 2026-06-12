import type { VerifyOutcome, SupplierPathOutcome } from './verifyOutcome'

/**
 * On-chain mempool/tx validity window in blocks. Used both as the broadcaster's
 * pre-broadcast expiry check and as the per-sweep hash-scan window. Single source —
 * the scan window and the verdict window MUST agree.
 */
export const TX_EXPIRATION_BLOCKS = 30

export interface DecideInput {
  hash: VerifyOutcome<{ success: boolean; code: number; gasUsed: string }>
  /** null when the tx type has no supplier path (e.g. send / OperationalFunds) */
  supplier: SupplierPathOutcome | null
  executionHeight: number
  expirationWindow: number
  /**
   * timeoutHeight embedded in the signed tx (Cosmos ante rejects inclusion in any
   * block with height > timeoutHeight). null when the tx has no embedded timeout
   * (external-wallet signed / legacy rows) — failure then requires sequence evidence.
   */
  txTimeoutHeight: number | null
  /**
   * Sequence-consumed evidence: account.sequence > tx.sequence observed at chain
   * head `observedAtHeight`. Once consumed, the tx can never land in a FUTURE block;
   * failure additionally requires hash-absence covered up to observedAtHeight
   * (the tx could have been the consumer in the uncovered gap).
   */
  sequence: { consumed: boolean; observedAtHeight: number } | null
}

export interface VerificationDecision {
  /** Truth about THIS tx: executed ok / provably can never apply / unknown. */
  tx: 'success' | 'failure' | 'pending'
  /** Goal-state reconciliation to run. Destructive failure effects ONLY on verified-absent goal. */
  effects: 'apply-success' | 'apply-failure' | 'none'
  /** Operators with negative supplier evidence; failure effects act only on these when present. */
  failedOperators?: string[]
  code?: number
  gasUsed?: string
  newLastCoveredHeight?: number
  /** any applicable path was unavailable */
  incUnavailable: boolean
}

/**
 * Pure transition logic. `tx` is per-tx truth; `effects` is goal-state truth —
 * they diverge when a sibling tx achieved the goal after this tx failed.
 * Failure requires COMPLETE negative evidence under a healthy RPC AND a proof
 * that the tx cannot land later (timeoutHeight covered, or sequence consumed
 * with coverage up to the observation height). Any unavailable path keeps the
 * tx pending (indefinitely). The verdict is height-based, never counter-based.
 */
export function decideVerification(input: DecideInput): VerificationDecision {
  const { hash, supplier, txTimeoutHeight, sequence } = input

  const supplierApplicable = supplier !== null
  const anyUnavailable =
    hash.status === 'unavailable' || (supplierApplicable && supplier!.status === 'unavailable')

  // 1. This tx executed successfully.
  if (hash.status === 'confirmed' && hash.data.success) {
    return { tx: 'success', effects: 'apply-success', code: hash.data.code, gasUsed: hash.data.gasUsed, incUnavailable: false }
  }

  // 2. This tx executed and failed (DeliverTx code != 0): per-tx failure is definitive,
  //    but destructive effects require knowing the goal-state.
  if (hash.status === 'confirmed' && !hash.data.success) {
    if (!supplierApplicable) {
      return { tx: 'failure', effects: 'none', code: hash.data.code, gasUsed: hash.data.gasUsed, incUnavailable: false }
    }
    if (supplier!.status === 'confirmed') {
      // Goal met by a sibling tx — do NOT release/penalize staked state.
      return { tx: 'failure', effects: 'apply-success', code: hash.data.code, gasUsed: hash.data.gasUsed, incUnavailable: false }
    }
    if (supplier!.status === 'absent') {
      return { tx: 'failure', effects: 'apply-failure', failedOperators: supplier!.absentOperators, code: hash.data.code, gasUsed: hash.data.gasUsed, incUnavailable: false }
    }
    // supplier unavailable: wait — never run destructive effects on an unknown goal-state.
    return { tx: 'pending', effects: 'none', incUnavailable: true }
  }

  // 3. Goal-state verified on-chain without hash evidence (degraded-RPC fallback).
  //    No code/gasUsed — leave persisted values untouched downstream.
  if (supplierApplicable && supplier!.status === 'confirmed') {
    return { tx: 'success', effects: 'apply-success', incUnavailable: false }
  }

  // 4. Failure: hash absent over a window the tx provably cannot land outside of,
  //    AND the goal-state answered absent (or no goal-state exists).
  if (hash.status === 'absent') {
    const requiredCoverage =
      txTimeoutHeight != null ? txTimeoutHeight
      : sequence?.consumed ? sequence.observedAtHeight
      : Number.POSITIVE_INFINITY
    const supplierNegativeOrNA = !supplierApplicable || supplier!.status === 'absent'
    if (hash.coveredUpToHeight >= requiredCoverage && supplierNegativeOrNA) {
      return {
        tx: 'failure',
        effects: supplierApplicable ? 'apply-failure' : 'none',
        failedOperators: supplierApplicable ? supplier!.absentOperators : undefined,
        incUnavailable: false,
      }
    }
  }

  // 5. Pending. Advance coverage only when the hash path answered.
  return {
    tx: 'pending',
    effects: 'none',
    newLastCoveredHeight: hash.status === 'absent' ? hash.coveredUpToHeight : undefined,
    incUnavailable: anyUnavailable,
  }
}
