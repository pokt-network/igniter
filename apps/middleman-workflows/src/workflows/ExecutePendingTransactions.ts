import {proxyActivities, WorkflowIdReusePolicy} from "@temporalio/workflow";
import { delegatorActivities } from '@/activities';
import {executeChild, log} from "@temporalio/workflow";

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

  const limit = pLimit(MAX_CONCURRENT_TRANSACTIONS);

  const childPromises = txs.map(({ id, createdAt }) =>
    limit(() => {
      const workflowId = `ExecuteTransaction-${id}-${createdAt}`;
      return executeChild("ExecuteTransaction", {
        workflowId,
        args: [{ transactionId: id }],
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
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
}
