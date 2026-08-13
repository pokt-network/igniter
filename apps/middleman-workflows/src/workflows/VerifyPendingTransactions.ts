import { proxyActivities, log, ApplicationFailure } from '@temporalio/workflow'
import { delegatorActivities } from '@/activities'
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
  } = proxyActivities<ReturnType<typeof delegatorActivities>>({
    startToCloseTimeout: '120s',
    // The default 3 attempts at a 1s base exhaust in ~4s — shorter than a single
    // block (~60s on mainnet), so any RPC hiccup tied to the chain's own cadence
    // (a node at a commit boundary, a backend a block behind) burns every attempt
    // inside one block and reports a permanent failure for a transient condition.
    // Span more than one block instead.
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
        // Run supplier path unless the hash confirmed success (goal already proven).
        const supplier = (hash.status === 'confirmed' && hash.data?.success) ? null : await verifySupplierEffect(t.id)
        // Gather validity evidence when the hash is absent (to detect expired/sequence-consumed txs faster).
        const needEvidence = hash.status === 'absent' || (hash.status === 'confirmed' && !hash.data?.success)
        const evidence = needEvidence
          ? await checkTxValidityEvidence(t.id)
          : { txTimeoutHeight: null, sequence: null }
        const decision = decideVerification({
          hash,
          supplier,
          executionHeight: t.executionHeight!,
          expirationWindow: TX_EXPIRATION_BLOCKS,
          txTimeoutHeight: evidence.txTimeoutHeight,
          sequence: evidence.sequence,
          txTimeoutTimestamp: null,
          chainTimeAtCoverage: null,
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
  // systemic one (all failed → RPC/DB down) instead of completing green. It MUST
  // be an ApplicationFailure: `WorkflowError` is a plain Error subclass (not a
  // TemporalFailure), so throwing it fails the workflow TASK instead of the
  // workflow, and the task then retries forever — under ScheduleOverlapPolicy.SKIP
  // that wedges the whole schedule (mainnet, 2026-08-10: 3 days without a sweep).
  // A failed execution lets the next scheduled sweep run fresh.
  if (results.length > 0 && failedReasons.length === results.length) {
    throw new ApplicationFailure(
      'VerifyPendingTransactions: all transactions failed',
      'fatal_error',
      true,
      [failedReasons],
    )
  }
}
