import * as wf from '@temporalio/workflow'
import {
  ChildWorkflowHandle,
  log,
  proxyActivities,
  ApplicationFailure,
} from '@temporalio/workflow'
import {
  providerActivities,
} from '@/activities'
import { SupplierRemediationByRange } from '@/workflows/SupplierRemediationRange'
import {makeRangesBySize} from "@/lib/utils";

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'
import {KeyState, RemediationHistoryEntryReason} from "@igniter/db/provider/enums";

/**
 * Represents the total number of shards used by the workflow.
 * A shard is a logical partition of data or workload that allows for
 * distributed processing and scalability.
 *
 * This value defines the total count of such partitions that are expected
 * or configured for the system to function.
 */
const shardCount = 200

export interface SupplierRemediationInput {
  reasons: RemediationHistoryEntryReason[]
}


/**
 * Executes the SupplierRemediation process which retrieves the latest block, determines the range of keys,
 * and orchestrates child workflows for remediation tasks within calculated ranges.
 * The method ensures bounded concurrency for child workflows and handles failures appropriately.
 *
 * @return {Promise<{ height: number, minId: number, maxId: number }>} A promise resolving to an object containing
 *         the latest block height, the minimum ID, and the maximum ID processed during the remediation.
 */
export async function SupplierRemediation(input: SupplierRemediationInput): Promise<{ height: number, minId: number, maxId: number }> {
  const { getLatestBlock, getKeysMinAndMax } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '390s',
      retry: {
        maximumAttempts: 3,
      },
    })

  log.info('SupplierRemediation:  Execution Started')

  const [height, { minId, maxId }] = await Promise.all([
    getLatestBlock(),
    getKeysMinAndMax(),
  ])

  if (minId == null || maxId == null) {
    log.info('SupplierRemediation: No keys found, nothing to remediate.')
    return { height, minId: 0, maxId: 0 }
  }

  const loggerContext = {
    height,
    minId,
    maxId,
  }

  log.debug('SupplierRemediation:  Block and key ranges retrieved', {
    ...loggerContext,
  })

  log.debug('SupplierRemediation: Preparing to trigger child workflows', { ...loggerContext })

  const notInStates = [
    KeyState.Available,
    KeyState.Unstaked,
    KeyState.RemediationFailed,
    KeyState.AttentionNeeded,
    KeyState.MissingStake,
  ]

  const ranges = makeRangesBySize(minId, maxId, shardCount, notInStates)

  log.debug('SupplierRemediation: Range shards prepared', { ...loggerContext, rangesCount: ranges.length, notInStates })

  const limitChildren = pLimit(10)

  log.debug('SupplierRemediation: created limited execution factory (10 concurrent)');

  // Schedule ALL children, but only `maxChildConcurrency` run at once.
  const childPromises = ranges.map(({ minId, maxId, states }) => {
    log.debug('SupplierRemediation: Executing child workflow for rage', { minId, maxId })
    return limitChildren(async () => {
      const childLoggerContext = {
        workflowName: 'SupplierRemediationByRange',
        height,
        minId,
        maxId,
        reasons: input.reasons,
        pageSize: 200,
        concurrency: 10,
      };
      log.debug('SupplierRemediation: Triggering child SupplierRemediationByRange workflow', { ...childLoggerContext })
      // Await this child's completion to enforce the concurrency cap
      let handle: ChildWorkflowHandle<typeof SupplierRemediationByRange> | undefined;
      try {
        handle = await wf.startChild<typeof SupplierRemediationByRange>('SupplierRemediationByRange', {
          args: [{
            states,
            height,
            minId,
            maxId,
            reasons: input.reasons,
            pageSize: 200,
            concurrency: 10,
          }],
          parentClosePolicy: 'ABANDON', // they will keep running if the father timeout
          workflowId: `SRR-${height}-${minId}-${maxId}`,
        })
      } catch (error: any) {
        log.error('An error occurred while starting child workflow', {
          ...childLoggerContext,
          error: error.message,
          stack: error.stack,
        })
        throw error;
      }

      try {
        await handle.result();
      } catch (error: any) {
        log.error('An error occurred while executing child workflow', {
          ...childLoggerContext,
          error: error.message,
          stack: error.stack,
        })
      }
    })
  })

  if (childPromises.length === 0) {
    log.info('SupplierRemediation: Execution Ended', { height, minId, maxId })
    return { height, minId, maxId };
  }

  log.debug('SupplierRemediation: Child workflows scheduled. Waiting for promises to settle.', { ...loggerContext, childPromisesCount: childPromises.length })

  const r = await Promise.allSettled(childPromises)

  const allFailed = r.every(r => {
    if (r.status === 'rejected') {
      log.warn(`SupplierRemediation: Child workflow failed with: ${r.reason}`)
    }
    return r.status === 'rejected';
  })

  const failedReasons = r.filter(r => r.status === 'rejected').map((r) => {
    return r.reason;
  });

  if (allFailed) {
    throw new ApplicationFailure(
      'SupplierRemediation: All child workflows failed. Something is wrong.',
      'fatal_error',
      true,
      [failedReasons],
    )
  }

  log.info('SupplierRemediation: Execution Ended', { height, minId, maxId, failedReasons })

  return { height, minId, maxId }
}
