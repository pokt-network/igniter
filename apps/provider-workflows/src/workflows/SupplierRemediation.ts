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
import { SupplierRemediationByRange, RemediationRangeResult } from '@/workflows/SupplierRemediationRange'
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

  const { sendNotifications: sendNotificationsBestEffort } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '30s',
      retry: { maximumAttempts: 1 },
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
          workflowId: `SRR-${input.reasons.join('-')}-${height}-${minId}-${maxId}`,
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
        return await handle.result();
      } catch (error: any) {
        log.error('An error occurred while executing child workflow', {
          ...childLoggerContext,
          error: error.message,
          stack: error.stack,
        })
        return { succeeded: [], failed: [] }
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
      log.warn('SupplierRemediation: Child workflow failed', { reason: r.reason })
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

  // Aggregate results for notifications
  const aggregated: RemediationRangeResult = { succeeded: [], failed: [] }
  for (const settled of r) {
    if (settled.status !== 'fulfilled') continue
    aggregated.succeeded.push(...settled.value.succeeded)
    aggregated.failed.push(...settled.value.failed)
  }

  const total = aggregated.succeeded.length + aggregated.failed.length
  if (total > 0) {
    const reasonLabels: Record<RemediationHistoryEntryReason, string> = {
      [RemediationHistoryEntryReason.ServiceMismatch]: 'Service Mismatch',
      [RemediationHistoryEntryReason.DelegatorAddressMissing]: 'Delegator Address Missing',
      [RemediationHistoryEntryReason.OwnerInitialStake]: 'Owner Initial Stake',
      [RemediationHistoryEntryReason.SupplierStakeTooLow]: 'Supplier Stake Too Low',
      [RemediationHistoryEntryReason.SupplierFundsTooLow]: 'Supplier Funds Too Low',
      [RemediationHistoryEntryReason.AddressGroupMigration]: 'Address Group Migration',
      [RemediationHistoryEntryReason.ManualUnstake]: 'Manual Unstake',
      [RemediationHistoryEntryReason.ReturnSupplierFunds]: 'Return Supplier Funds',
    }

    // Build a map of reason → { succeeded, failed }
    // Succeeded: grouped by the reason actually applied per address
    // Failed: attributed to all input reasons (activity threw before a reason could be determined)
    const byReason: Record<string, { succeeded: string[]; failed: string[] }> = {}

    for (const reason of input.reasons) {
      byReason[reason] = { succeeded: [], failed: [] }
    }

    for (const { address, reasons } of aggregated.succeeded) {
      for (const reason of reasons) {
        if (!byReason[reason]) byReason[reason] = { succeeded: [], failed: [] }
        byReason[reason].succeeded.push(address)
      }
    }

    for (const address of aggregated.failed) {
      for (const reason of input.reasons) {
        byReason[reason]!.failed.push(address)
      }
    }

    // OwnerInitialStake completions are already announced by the "Suppliers Staked" event
    // (keys_staked fires once a fresh stake has its services configured). Drop those
    // SUCCESSES from the remediation summary so a brand-new stake doesn't double-notify;
    // keep OwnerInitialStake FAILURES so a botched initial stake still surfaces here.
    const notifiableByReason: Record<string, { succeeded: string[]; failed: string[] }> = {}
    for (const [reason, { succeeded, failed }] of Object.entries(byReason)) {
      const keepSucceeded =
        reason === RemediationHistoryEntryReason.OwnerInitialStake ? [] : succeeded
      if (keepSucceeded.length > 0 || failed.length > 0) {
        notifiableByReason[reason] = { succeeded: keepSucceeded, failed }
      }
    }

    const notifiableAddresses = new Set<string>()
    for (const { succeeded, failed } of Object.values(notifiableByReason)) {
      succeeded.forEach((a) => notifiableAddresses.add(a))
      failed.forEach((a) => notifiableAddresses.add(a))
    }
    const notifiableTotal = notifiableAddresses.size

    // Nothing left to report (e.g. the run only completed fresh initial stakes) → no
    // remediation notification; keys_staked already covered it.
    if (notifiableTotal > 0) {
      const reasonSummaryLines = Object.entries(notifiableByReason)
        .map(([reason, { succeeded, failed }]) => {
          const label = reasonLabels[reason as RemediationHistoryEntryReason] ?? reason
          const parts = []
          if (succeeded.length > 0) parts.push(`✓ ${succeeded.length} succeeded`)
          if (failed.length > 0) parts.push(`✗ ${failed.length} failed`)
          return `\n• ${label}: ${parts.join(', ')}`
        })

      await sendNotificationsBestEffort({
        type: 'remediation_summary',
        summary: {
          title: 'Remediation Complete',
          body: [
            `Remediation run at block ${height} processed ${notifiableTotal} supplier${notifiableTotal > 1 ? 's' : ''}.`,
            ...reasonSummaryLines,
          ].join(''),
        },
        metadata: { byReason: notifiableByReason, height },
      })
    }
  }

  log.info('SupplierRemediation: Execution Ended', { height, minId, maxId, failedReasons })

  return { height, minId, maxId }
}
