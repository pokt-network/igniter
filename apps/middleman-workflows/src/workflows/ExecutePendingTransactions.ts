import {proxyActivities, WorkflowIdReusePolicy, ParentClosePolicy} from "@temporalio/workflow";
import { delegatorActivities } from '@/activities';
import {executeChild, log, ApplicationFailure} from "@temporalio/workflow";

// @ts-expect-error p-limit is ESM-only; its default export has no CJS types under this build's module resolution
import pLimit from 'p-limit'

export interface ExecutePendingTransactionsArgs {}


const MAX_CONCURRENT_TRANSACTIONS = 10

export async function ExecutePendingTransactions(args: ExecutePendingTransactionsArgs) {
  const { listTransactions } =
    proxyActivities<ReturnType<typeof delegatorActivities>>({
      startToCloseTimeout: "30s",
      retry: {
        maximumAttempts: 3,
      },
    });

  const txs = await listTransactions();

  if (txs.length === 0) {
    log.debug('ExecutePendingTransactions: no pending transactions');
    return;
  }

  const limit = pLimit(MAX_CONCURRENT_TRANSACTIONS);

  const childPromises = txs.map(({ id, createdAt }) =>
    limit(() => {
      const workflowId = `ExecuteTransaction-${id}-${createdAt}`;
      return executeChild("ExecuteTransaction", {
        workflowId,
        args: [{ transactionId: id }],
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
        parentClosePolicy: ParentClosePolicy.ABANDON,
        retry: {
          maximumAttempts: 5,
        },
      }).catch((err) => {
        if (err.name === "WorkflowExecutionAlreadyStartedError") {
          log.info(`Workflow with ID=${workflowId} is already running, skipping.`);
        } else {
          throw err;
        }
      });
    })
  );

  const results = await Promise.allSettled(childPromises);

  for (const r of results) {
    if (r.status === "rejected") {
      log.warn("ExecutePendingTransactions: child workflow failed", { reason: String(r.reason) });
    }
  }

  // Match the SupplierStatus pattern: a partial failure is tolerated (one bad tx
  // shouldn't block the rest), but if every scheduled child failed the run is a
  // systemic problem (e.g. RPC/DB down) and must surface as a workflow failure
  // rather than completing green. Guard against the empty-batch case where
  // `every` would vacuously return true.
  const allFailed =
    results.length > 0 && results.every((r) => r.status === "rejected");
  if (allFailed) {
    throw new ApplicationFailure("ExecutePendingTransactions: all child workflows failed", "fatal_error", true);
  }
}
