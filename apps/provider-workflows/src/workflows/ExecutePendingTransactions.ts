import { proxyActivities, executeChild, log, ApplicationFailure, WorkflowIdReusePolicy, ParentClosePolicy } from '@temporalio/workflow'
import { providerActivities } from '@/activities'

// @ts-expect-error p-limit is ESM-only; its default export has no CJS types under this build's module resolution
import pLimit from 'p-limit'

const MAX_CONCURRENT = 10

export async function ExecutePendingTransactions() {
  const { listPending } = proxyActivities<ReturnType<typeof providerActivities>>({
    startToCloseTimeout: '30s',
    retry: { maximumAttempts: 3 },
  })

  const txs = await listPending()
  if (txs.length === 0) {
    log.debug('ExecutePendingTransactions: no pending transactions')
    return
  }

  const limit = pLimit(MAX_CONCURRENT)

  const results = await Promise.allSettled(
    txs.map((t) =>
      limit(() => {
        const workflowId = `ExecuteTransaction-${t.id}`
        return executeChild('ExecuteTransaction', {
          workflowId,
          args: [{ transactionId: t.id }],
          workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
          parentClosePolicy: ParentClosePolicy.ABANDON,
          retry: { maximumAttempts: 5 },
        }).catch((err) => {
          if (err.name === 'WorkflowExecutionAlreadyStartedError') {
            log.info(`ExecuteTransaction ${workflowId} already running, skipping.`)
          } else {
            throw err
          }
        })
      })
    )
  )

  const failedReasons = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason))
  for (const reason of failedReasons) {
    log.warn('ExecutePendingTransactions: child workflow failed', { reason })
  }

  // Non-retryable ApplicationFailure (NOT WorkflowError — it IS exported and does
  // construct, but it extends plain Error rather than TemporalFailure, so throwing
  // it fails the workflow TASK instead of the workflow; the task then retries
  // forever, wedging the schedule under ScheduleOverlapPolicy.SKIP). A failed
  // execution lets the next scheduled dispatch run fresh.
  if (results.length > 0 && failedReasons.length === results.length) {
    throw new ApplicationFailure(
      'ExecutePendingTransactions: all child workflows failed',
      'fatal_error',
      true,
      [failedReasons],
    )
  }
}
