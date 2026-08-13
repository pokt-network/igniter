import { proxyActivities, log, ApplicationFailure } from '@temporalio/workflow'
import { providerActivities } from '@/activities'
import { decideVerification, TX_EXPIRATION_BLOCKS } from '@igniter/tx-verify'

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'
const MAX_CONCURRENT = 10

/**
 * Sweeps broadcast-but-unverified transactions (status pending ∧ hash != null) and
 * drives each toward a terminal verdict via the two verification paths + the pure
 * `decideVerification`. RPC-unavailable never mutates state (the tx stays pending),
 * so a degraded RPC produces retries + alerts, never a false failure.
 */
export async function VerifyPendingTransactions() {
  const {
    listPendingWithHash,
    verifyTxHash,
    verifySupplierEffect,
    checkTxValidityEvidence,
    applyVerificationDecision,
  } = proxyActivities<ReturnType<typeof providerActivities>>({
    startToCloseTimeout: '120s',
    // The default 3 attempts at a 1s base exhaust in ~4s — shorter than a single
    // block (~60s on mainnet), so an RPC hiccup tied to the chain's own cadence
    // burns every attempt inside one block. Span more than one block instead.
    retry: {
      initialInterval: '5s',
      backoffCoefficient: 2,
      maximumInterval: '30s',
      maximumAttempts: 5,
    },
  })

  const txs = await listPendingWithHash()
  if (txs.length === 0) {
    log.debug('VerifyPendingTransactions: no pending transactions')
    return
  }

  const limit = pLimit(MAX_CONCURRENT)
  const results = await Promise.allSettled(
    txs.map((t) =>
      limit(async () => {
        const hash = await verifyTxHash(t.id)
        // Supplier path runs whenever we cannot confirm success from the hash alone:
        // also when hash confirmed code!=0 (sibling may have achieved goal-state).
        const supplier = hash.status === 'confirmed' && hash.data.success ? null : await verifySupplierEffect(t.id)
        // Evidence only when failure is in reach (avoids an unnecessary account query on every sweep).
        const needEvidence = hash.status === 'absent' || (hash.status === 'confirmed' && !hash.data.success)
        // For absent: pass the chain block time at coverage so decideVerification uses chain time
        // (not wall-clock) for the unordered timeout_timestamp bound.
        const chainTimeAtCoverage = hash.status === 'absent' ? hash.chainTimeAtCoverage ?? null : null
        const evidence = needEvidence
          ? await checkTxValidityEvidence(t.id, chainTimeAtCoverage)
          : { txTimeoutHeight: null, txTimeoutTimestamp: null, sequence: null, chainTimeAtCoverage: null }
        const decision = decideVerification({
          hash,
          supplier,
          executionHeight: t.executionHeight!,
          expirationWindow: TX_EXPIRATION_BLOCKS,
          txTimeoutHeight: evidence.txTimeoutHeight,
          txTimeoutTimestamp: evidence.txTimeoutTimestamp,
          sequence: evidence.sequence,
          chainTimeAtCoverage: evidence.chainTimeAtCoverage,
        })
        await applyVerificationDecision(t.id, decision)
      }),
    ),
  )

  const failedReasons = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason))
  for (const reason of failedReasons) {
    log.warn('VerifyPendingTransactions: tx verification failed', { reason })
  }

  // Match the SupplierStatus pattern: tolerate partial failure, but surface a
  // systemic one (all failed → RPC/DB down) instead of completing green. Use a
  // non-retryable ApplicationFailure (NOT WorkflowError — it IS exported and does
  // construct, but it extends plain Error rather than TemporalFailure, so throwing
  // it fails the workflow TASK instead of the workflow; the task then retries
  // forever, wedging the schedule under ScheduleOverlapPolicy.SKIP — exactly what
  // hit middleman on mainnet on 2026-08-10). A failed execution lets the next
  // scheduled sweep run fresh.
  if (results.length > 0 && failedReasons.length === results.length) {
    throw new ApplicationFailure(
      'VerifyPendingTransactions: all transactions failed',
      'fatal_error',
      true,
      [failedReasons],
    )
  }
}
