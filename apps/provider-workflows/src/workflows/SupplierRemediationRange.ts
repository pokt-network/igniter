import {ApplicationFailure, log, proxyActivities} from '@temporalio/workflow'
import {LoadKeysInRangeResult, providerActivities,} from '@/activities'

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'
import {KeyState, RemediationHistoryEntryReason} from "@igniter/db/provider/enums";

type SupplierRemediationByRange = {
  height: number
  minId: number
  maxId: number
  pageSize: number
  concurrency: number
  reasons?: RemediationHistoryEntryReason[]
  states: KeyState[]
}

/**
 * Handles processing of supplier remediation within a given range by loading keys and updating supplier status.
 *
 * @param {SupplierRemediationByRange} input - The input object containing the necessary parameters to perform supplier remediation. Fields include:
 *   - minId: The minimum ID in the range.
 *   - maxId: The maximum ID in the range.
 *   - concurrency: The maximum number of concurrent tasks. Defaults to 50.
 *   - height: The input height for supplier status update.
 * @return {Promise<void>} A promise that resolves once the supplier remediation process has completed or rejects in case all operations in the range fail.
 */
export async function SupplierRemediationByRange(input: SupplierRemediationByRange): Promise<void> {
  log.info('SupplierRemediationByRange: execution started', { minId: input.minId, maxId: input.maxId })
  const { loadKeysInRange, remediateSupplier } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '240s',
      retry: {
        maximumAttempts: 10,
      },
    })

  const limit = pLimit(input.concurrency ?? 50);

  const rows: LoadKeysInRangeResult = await loadKeysInRange(input);

  if(rows.length === 0) {
    log.warn('SupplierRemediationByRange: No rows found for range', { minId: input.minId, maxId: input.maxId })
    return
  }

  log.debug('SupplierRemediationByRange: Loaded keys from range. Scheduling remediation activity for each key.', { minId: input.minId, maxId: input.maxId, totalKeysLoaded: rows.length })

  const r = await Promise.allSettled(
    rows.map(r => limit(() =>
      remediateSupplier({
        address: r.address,
        height: input.height,
        reasons: input.reasons ?? [],
      })
    ))
  );

  const allFailed = r.every(r => {
    if (r.status === 'rejected') {
      log.warn(`SupplierRemediationByRange: Child workflow failed with: ${r.reason}`)
    }
    return r.status === 'rejected';
  })

  const failedReasons = r.filter(r => r.status === 'rejected').map((r) => {
    return r.reason;
  });

  if (allFailed) {
    throw new ApplicationFailure(
      'SupplierRemediationByRange: All child workflows failed. Something is wrong.',
      'fatal_error',
      true,
      [failedReasons],
    )
  }

  log.info('SupplierRemediationByRange: Execution Ended', { height: input.height, minId: input.minId, maxId: input.maxId, failedReasons })
}
