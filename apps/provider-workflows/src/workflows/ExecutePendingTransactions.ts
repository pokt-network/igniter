import { proxyActivities, executeChild, log, WorkflowError, WorkflowIdReusePolicy, ParentClosePolicy } from '@temporalio/workflow'
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
  if (txs.length === 0) return

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

  for (const r of results) {
    if (r.status === 'rejected') {
      log.warn('ExecutePendingTransactions: child workflow failed', { reason: String(r.reason) })
    }
  }

  if (results.length > 0 && results.every((r) => r.status === 'rejected')) {
    throw new WorkflowError('ExecutePendingTransactions: all child workflows failed')
  }
}
