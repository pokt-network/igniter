import { proxyActivities, log, WorkflowError } from '@temporalio/workflow'
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
    expireStaleBroadcasts,
    listPendingWithHash,
    verifyTxHash,
    verifySupplierEffect,
    checkTxValidityEvidence,
    applyVerificationDecision,
  } = proxyActivities<ReturnType<typeof providerActivities>>({
    startToCloseTimeout: '120s',
    retry: { maximumAttempts: 3 },
  })

  // Hygiene: expire WAL rows whose broadcast outcome is unknown (worker crashed
  // between claim and arm). Must run before listing pending-with-hash so the
  // sweep never attempts to verify a hash-less row. Log per expired row.
  await expireStaleBroadcasts()

  const txs = await listPendingWithHash()
  if (txs.length === 0) return

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
        const evidence = needEvidence ? await checkTxValidityEvidence(t.id) : { txTimeoutHeight: null, sequence: null }
        const decision = decideVerification({
          hash,
          supplier,
          executionHeight: t.executionHeight!,
          expirationWindow: TX_EXPIRATION_BLOCKS,
          txTimeoutHeight: evidence.txTimeoutHeight,
          sequence: evidence.sequence,
        })
        await applyVerificationDecision(t.id, decision)
      }),
    ),
  )

  for (const r of results) {
    if (r.status === 'rejected') {
      log.warn('VerifyPendingTransactions: tx verification failed', { reason: String(r.reason) })
    }
  }

  // Match the SupplierStatus pattern: tolerate partial failure, but surface a
  // systemic one (all failed → RPC/DB down) instead of completing green.
  if (results.length > 0 && results.every((r) => r.status === 'rejected')) {
    throw new WorkflowError('VerifyPendingTransactions: all transactions failed')
  }
}
