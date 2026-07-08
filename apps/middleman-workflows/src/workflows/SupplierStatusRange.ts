import {
  log,
  proxyActivities,
  WorkflowError,
} from '@temporalio/workflow'
import {
  delegatorActivities,
  LoadNodesInRangeResult,
} from '@/activities'

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'

type SupplierStatusByRange = {
  height: number
  minId: number
  maxId: number
  pageSize: number
  concurrency: number
}

/**
 * Processes and updates supplier statuses within the specified range.
 *
 * This method uses concurrent requests to fetch and update supplier statuses
 * in a paginated manner. The parameters allow specifying the range of IDs to process,
 * the size of each page, and the level of concurrency for parallel processing.
 *
 * @param {Object} input - The input for processing supplier statuses in a specified range.
 * @param {number} input.startId - The starting ID for the range of supplier statuses to process.
 * @param {number} input.endId - The ending ID for the range of supplier statuses to process.
 * @param {number} [input.pageSize=500] - The number of supplier statuses to fetch per page. Defaults to 500 if not provided.
 * @param {number} [input.concurrency=50] - The maximum number of concurrent requests to process supplier statuses. Defaults to 50 if not provided.
 * @param {number} input.height - The height level at which supplier statuses are being updated.
 *
 * @return {Promise<void>} A promise that resolves when all supplier statuses in the specified range are processed.
 */
export async function SupplierStatusByRange(input: SupplierStatusByRange): Promise<void> {
  const { loadNodesInRange, upsertSupplierStatus } =
    proxyActivities<ReturnType<typeof delegatorActivities>>({
      startToCloseTimeout: '10s',
      retry: {
        maximumAttempts: 10,
      },
    })

  const limit = pLimit(input.concurrency ?? 50);

  const rows: LoadNodesInRangeResult = await loadNodesInRange({ minId: input.minId, maxId: input.maxId });

  if(rows.length === 0) {
    log.warn('No rows found for range', { minId: input.minId, maxId: input.maxId })
    return
  }

  const r = await Promise.allSettled(
    rows.map(r => limit(() =>
      upsertSupplierStatus({
        address: r.address,
        height: input.height,
      })
    ))
  );

  const allFailed = r.every(r => {
    if( r.status === 'rejected') {
      log.error('Failed to update supplier status', { reason: r })
    }
    return r.status === 'rejected'
  });
  if (allFailed) {
    throw new WorkflowError('All activities failed');
  }

  const upserted = r.filter(r => r.status === 'fulfilled').length
  log.info('supplier sync range done', { keysChecked: rows.length, upserted, minId: input.minId, maxId: input.maxId })
}
