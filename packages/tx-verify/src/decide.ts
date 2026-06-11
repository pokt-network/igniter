import type { VerifyOutcome } from './verifyOutcome'

export interface DecideInput {
  hash: VerifyOutcome<{ success: boolean; code: number; gasUsed: bigint }>
  /** null when the tx type has no supplier path (e.g. send / OperationalFunds) */
  supplier: VerifyOutcome<unknown> | null
  executionHeight: number
  expirationWindow: number
}

export interface VerificationDecision {
  outcome: 'success' | 'failure' | 'pending'
  code?: number
  gasUsed?: bigint
  newLastCoveredHeight?: number
  /** RPC answered on the hash path (confirmed/absent) */
  advanceTxAttempt: boolean
  /** RPC answered on the supplier path (confirmed/absent) */
  advanceSupplierAttempt: boolean
  /** any applicable path was unavailable */
  incUnavailable: boolean
}

/**
 * Pure transition logic. Decides success/failure/pending from the two path
 * outcomes. Failure requires COMPLETE negative evidence under a healthy RPC;
 * any unavailable path keeps the tx pending (indefinitely). The verdict is
 * height-based (hash window covered), never counter-based.
 */
export function decideVerification(input: DecideInput): VerificationDecision {
  const { hash, supplier, executionHeight, expirationWindow } = input
  const windowEnd = executionHeight + expirationWindow - 1

  const hashAnswered = hash.status !== 'unavailable'
  const supplierApplicable = supplier !== null
  const supplierAnswered = supplierApplicable && supplier!.status !== 'unavailable'
  const anyUnavailable =
    hash.status === 'unavailable' || (supplierApplicable && supplier!.status === 'unavailable')

  // 1. Any path confirmed → success.
  if (hash.status === 'confirmed') {
    return {
      outcome: 'success',
      code: hash.data.code,
      gasUsed: hash.data.gasUsed,
      advanceTxAttempt: true,
      advanceSupplierAttempt: supplierAnswered,
      incUnavailable: false,
    }
  }
  if (supplierApplicable && supplier!.status === 'confirmed') {
    // Confirmed via supplier state, not the tx hash → we have no code/gasUsed for
    // this tx. Leave them undefined so applyVerificationDecision does NOT overwrite
    // the persisted consumedFee/code with a fabricated 0.
    return {
      outcome: 'success',
      advanceTxAttempt: hashAnswered,
      advanceSupplierAttempt: true,
      incUnavailable: false,
    }
  }

  // 2. Failure requires COMPLETE negative evidence under a healthy RPC:
  //    hash window covered AND (no supplier path OR supplier answered-without-effect).
  const hashClosedNegative = hash.status === 'absent' && hash.coveredUpToHeight >= windowEnd
  const supplierNegativeOrNA = !supplierApplicable || supplier!.status === 'absent'
  if (hashClosedNegative && supplierNegativeOrNA) {
    return {
      outcome: 'failure',
      advanceTxAttempt: true,
      advanceSupplierAttempt: supplierAnswered,
      incUnavailable: false,
    }
  }

  // 3. Otherwise pending. Advance coverage/counters only for paths that answered.
  return {
    outcome: 'pending',
    newLastCoveredHeight: hash.status === 'absent' ? hash.coveredUpToHeight : undefined,
    advanceTxAttempt: hashAnswered,
    advanceSupplierAttempt: supplierAnswered,
    incUnavailable: anyUnavailable,
  }
}
