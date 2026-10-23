import { ActivityFailure, isCancellation, log, proxyActivities } from '@temporalio/workflow'
// Type-only: the workflow bundle must never pull the activities module in at runtime (it imports
// drizzle, pg and node:* — bundle.test.ts builds the real bundle to catch that).
import type { delegatorActivities } from '@/activities'

interface TransactionFailureEffectsArgs {
  transactionId: number
}

type Activities = ReturnType<typeof delegatorActivities>
type ReleaseOutcome = Awaited<ReturnType<Activities['releaseFailedStake']>>

/**
 * Executor of a failed row's outbox (any tx type; only a Stake row with a provider and addresses owes
 * a release, every other row goes straight to `done`): notifies the owner, then releases the keys its
 * provider reserved for it. Notify comes first so the owner learns of the failure at once, not
 * after up to 24h of not-sent release retries. Started by ExecutePendingTransactions as
 * `TransactionFailureEffects-<txId>` for every row whose `failureEffects` is `pending` or
 * `releasing`, and for every outbox row whose notice never claimed its fence (a notice that failed
 * in an earlier run is retried; the release step then finds `done` / `manual` and does nothing).
 *
 * THE FENCE IS THE DB ROW, not this run. `notifyFailedTransactionOwner` sends only after winning the
 * `failureNotifiedAt NULL → now()` CAS, and `releaseFailedStake` acts only through CAS transitions on
 * `failureEffects` (it POSTs only after winning `pending → releasing`, and a row found `releasing`
 * goes to `manual` without a POST). Each step keeps its own fence, so their order does not affect
 * at-most-once, and a re-entry — a second run after a crash, a stale listing, a person resetting
 * `manual → pending` — is idempotent: at most one notice, and at most one release POST unless the
 * previous one is known to be unsent.
 *
 * A notice that still fails after its 30m budget is logged and the release runs anyway: losing the
 * release because the notice failed would leave the keys reserved.
 *
 * The 25h `workflowExecutionTimeout` (notify budget 30m + release budget 24h) is set by the starter,
 * not here.
 *
 * REPLAY. This workflow shipped without a marker because it is new. A run lives at most 25h and
 * is replayed against its own history on every worker restart, so ANY later change to its command
 * sequence (activities added, removed, reordered, or a proxy option that changes what gets
 * scheduled) needs its own `patched()` marker.
 */
export async function TransactionFailureEffects({ transactionId }: TransactionFailureEffectsArgs) {
  // The notify fence and the row read are what can fail here; delivery itself never throws. The
  // fence makes retries safe, so it retries for up to 30m.
  const notify = proxyActivities<Pick<Activities, 'notifyFailedTransactionOwner'>>({
    startToCloseTimeout: '30s',
    scheduleToCloseTimeout: '30m',
    retry: {
      initialInterval: '5s',
      backoffCoefficient: 2,
      maximumInterval: '1m',
    },
  })

  // Definite not-sent outcomes throw a retryable failure and the row goes back to `pending`, so a
  // retry may POST again. No maximumAttempts: the 24h schedule-to-close budget is the bound.
  const release = proxyActivities<Pick<Activities, 'releaseFailedStake'>>({
    startToCloseTimeout: '60s',
    scheduleToCloseTimeout: '24h',
    retry: {
      initialInterval: '10s',
      backoffCoefficient: 2,
      maximumInterval: '10m',
    },
  })

  const exhaust = proxyActivities<Pick<Activities, 'markFailureEffectsExhausted'>>({
    startToCloseTimeout: '30s',
    retry: { maximumAttempts: 3 },
  })

  // Step 1: the owner hears about the failure once, and the fence keeps it to once.
  let notified: boolean
  try {
    notified = await notify.notifyFailedTransactionOwner(transactionId)
  } catch (error) {
    // Same rule as the release below: only an ActivityFailure that is not a cancellation is
    // absorbed. The notice is lost (a person must tell the owner); the release must still run.
    if (!(error instanceof ActivityFailure) || isCancellation(error)) throw error
    log.error('TransactionFailureEffects: owner notice did not go out; notify by hand, continuing with the release', {
      transactionId,
      error: error.message,
      cause: error.cause?.message,
    })
    notified = false
  }

  // Step 2: the release, whatever step 1 ended in.
  let releaseOutcome: ReleaseOutcome | 'exhausted'
  try {
    releaseOutcome = await release.releaseFailedStake(transactionId)
  } catch (error) {
    // Caught: any ActivityFailure, i.e. the release activity ended without an answer — its 24h
    // budget ran out on `release_not_sent`, or it kept failing on something unexpected (DB down)
    // until it did, or it threw a non-retryable failure. None of these says whether the keys are
    // free, so the row goes to `manual` for a person.
    // Not caught: cancellation (an operator cancelled the run; scheduling more activities in a
    // cancelled scope would fail anyway) and anything that is not an ActivityFailure — a bug in
    // this file must fail loudly, never be turned into a quiet `manual`.
    if (!(error instanceof ActivityFailure) || isCancellation(error)) throw error

    const moved = await exhaust.markFailureEffectsExhausted(transactionId)
    log.error('TransactionFailureEffects: release did not complete; row moved to manual, check the keys on the provider', {
      transactionId,
      moved, // false: another attempt had already moved the row on; not an error
      error: error.message,
      cause: error.cause?.message,
    })
    releaseOutcome = 'exhausted'
  }

  log.info('TransactionFailureEffects: done', { transactionId, release: releaseOutcome, notified })
  return { transactionId, release: releaseOutcome, notified }
}
