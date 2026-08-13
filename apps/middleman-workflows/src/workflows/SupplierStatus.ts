import * as wf from '@temporalio/workflow'
import {
  log,
  proxyActivities,
  ApplicationFailure,
} from '@temporalio/workflow'
import {
  delegatorActivities,
  LoadNodesInRangeParams,
} from '@/activities'
import { SupplierStatusByRange } from '@/workflows/SupplierStatusRange'

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'

/**
 * Represents the total number of shards used by the workflow.
 * A shard is a logical partition of data or workload that allows for
 * distributed processing and scalability.
 *
 * This value defines the total count of such partitions that are expected
 * or configured for the system to function.
 */
const shardCount = 200

/**
 * Divides a range of IDs into smaller ranges of specified size.
 *
 * @param {number} minId - The starting ID of the range.
 * @param {number} maxId - The ending ID of the range.
 * @param {number} shardSize - The size of each range or shard.
 * @return {Array<LoadNodesInRangeParams>} An array of objects, each representing a range with `startId` and `endId`.
 */
function makeRangesBySize(minId: number, maxId: number, shardSize: number): Array<LoadNodesInRangeParams> {
  const ranges: Array<LoadNodesInRangeParams> = []
  for (let start = minId; start <= maxId; start += shardSize) {
    const end = Math.min(start + shardSize - 1, maxId)
    ranges.push({ minId: start, maxId: end })
  }
  return ranges
}


/**
 * Executes the SupplierStatus workflow, which orchestrates multiple concurrent child workflows
 * to process supplier status within specified ranges.
 * This method divides the workload into shards of ranges and schedules child workflows with controlled concurrency.
 *
 * The method performs the following steps:
 * - Retrieves the latest block height and the minimum and maximum key IDs.
 * - Divides the range between minimum and maximum key IDs into evenly distributed shards.
 * - Schedules child workflows with bounded concurrency using the pLimit library.
 * - Monitors the completion of all child workflows.
 *
 * @return {Promise<void>} A promise that resolves when all child workflows are scheduled
 *                         and processed.
 *                         This method is a fire-and-forget operation for
 *                         orchestrating workflows.
 */
export async function SupplierStatus(): Promise<{ height: number, minId: number, maxId: number }> {
  const { getLatestBlock, getNodesMinAndMax } =
    proxyActivities<ReturnType<typeof delegatorActivities>>({
      startToCloseTimeout: '120s',
      retry: {
        maximumAttempts: 3,
      },
    })

  log.debug('Starting SupplierStatus')
  const [height, { minId, maxId }] = await Promise.all([
    getLatestBlock(),
    getNodesMinAndMax(),
  ])

  log.debug('Preparing to trigger child workflows', { height, minId, maxId })
  const ranges = makeRangesBySize(minId, maxId, shardCount)

  const limitChildren = pLimit(10)

  // Schedule ALL children, but only `maxChildConcurrency` run at once.
  const childPromises = ranges.map(({ minId, maxId }) =>
    limitChildren(async () => {
      log.debug('Triggering Child Workflow: SupplierStatusByRange', { minId, maxId })
      // Await this child's completion to enforce the concurrency cap
      await wf.startChild<typeof SupplierStatusByRange>('SupplierStatusByRange', {
        args: [{
          height: height,
          minId,
          maxId,
          pageSize: 200,
          concurrency: 10,
        }],
        parentClosePolicy: 'ABANDON', // they will keep running if the father timeout
        workflowId: `SSR-${height}-${minId}-${maxId}`,
      })
    }),
  )

  // Drain all children with bounded concurrency
  const r = await Promise.allSettled(childPromises)
  const allFailed = r.every(r => r.status === 'rejected')
  if (allFailed) {
    throw new ApplicationFailure('SupplierStatus: all child ranges failed', 'fatal_error', true)
  }

  log.debug('Completed SupplierStatus', { height, minId, maxId })
  return { height, minId, maxId }
}
