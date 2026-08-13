import * as wf from '@temporalio/workflow'
import {
  log,
  proxyActivities,
} from '@temporalio/workflow'
import {
  providerActivities,
} from '@/activities'
import { SupplierStatusByRange, StatusRangeResult } from '@/workflows/SupplierStatusRange'
import {makeRangesBySize} from "@/lib/utils";

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'
import {KeyState} from "@igniter/db/provider/enums";
import {ApplicationFailure} from "@temporalio/workflow";
import { buildStatusNotificationEvents } from '@/workflows/supplierStatusUtils'

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
  const { getLatestBlock, getKeysMinAndMax, sendNotifications } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '120s',
      retry: {
        maximumAttempts: 3,
      },
    })

  const { sendNotifications: sendNotificationsBestEffort } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '30s',
      retry: {
        maximumAttempts: 1,
      },
    })

  log.debug('SupplierStatus: Execution started')

  const [height, { minId, maxId }] = await Promise.all([
    getLatestBlock(),
    getKeysMinAndMax(),
  ])

  if (minId == null || maxId == null) {
    log.info('SupplierStatus: No keys found, nothing to check.')
    return { height, minId: 0, maxId: 0 }
  }

  const loggerContext = {
    height,
    minId,
    maxId,
  }

  log.debug('SupplierStatus:  Block and key ranges retrieved', {
    ...loggerContext,
  })

  log.debug('SupplierStatus: Preparing to trigger child workflows', { ...loggerContext })

  const notInStates = [
    KeyState.Unstaked,
    KeyState.RemediationFailed,
    KeyState.AttentionNeeded,
  ]
  const ranges = makeRangesBySize(minId, maxId, shardCount, notInStates)

  log.debug('SupplierStatus: Range shards prepared', { ...loggerContext, rangesCount: ranges.length, notInStates })

  const limitChildren = pLimit(10)

  log.debug('SupplierStatus: created limited execution factory (10 concurrent)');

  // Schedule ALL children, but only `maxChildConcurrency` run at once.
  const childPromises = ranges.map(({ minId, maxId, states }) => {
    log.debug('SupplierStatus: Executing child workflow for rage', { minId, maxId })
    return limitChildren(async () => {
      const childLoggerContext = {
        height,
        minId,
        maxId,
        pageSize: 200,
        concurrency: 10,
      };
      log.debug('SupplierStatus: Triggering child SupplierStatusByRange workflow', { ...childLoggerContext })
      const handle = await wf.startChild<typeof SupplierStatusByRange>('SupplierStatusByRange', {
        args: [{
          states,
          height,
          minId,
          maxId,
          pageSize: 200,
          concurrency: 10,
        }],
        parentClosePolicy: 'ABANDON',
        workflowId: `SSR-${height}-${minId}-${maxId}`,
      })
      return handle.result()
    })
  })

  if (childPromises.length === 0) {
    log.info('SupplierStatus: Execution Ended', { height, minId, maxId })
    return { height, minId, maxId };
  }

  log.debug('SupplierStatus: Child workflows scheduled. Waiting for promises to settle.', { ...loggerContext, childPromisesCount: childPromises.length })

  const r = await Promise.allSettled(childPromises)

  const allFailed = r.every(r => {
    if (r.status === 'rejected') {
      log.warn('SupplierStatus: Child workflow failed', { reason: r.reason })
    }
    return r.status === 'rejected';
  })

  const failedReasons = r.filter(r => r.status === 'rejected').map((r) => {
    return r.reason;
  });

  if (allFailed) {
    throw new ApplicationFailure(
      'SupplierStatus: All child workflows failed. Something is wrong.',
      'fatal_error',
      true,
      [failedReasons],
    )
  }

  // Aggregate results from all child workflows for notifications
  const aggregated: StatusRangeResult = { staked: [], unstaked: [], fundsLow: [], stakeLow: [] }
  for (const settled of r) {
    if (settled.status !== 'fulfilled') continue
    const res = settled.value
    aggregated.staked.push(...res.staked)
    aggregated.unstaked.push(...res.unstaked)
    aggregated.fundsLow.push(...res.fundsLow)
    aggregated.stakeLow.push(...res.stakeLow)
  }

  for (const event of buildStatusNotificationEvents(aggregated, height)) {
    await sendNotificationsBestEffort(event)
  }

  log.info('SupplierStatus: Execution Ended', { height, minId, maxId, failedReasons })
  return { height, minId, maxId }
}
