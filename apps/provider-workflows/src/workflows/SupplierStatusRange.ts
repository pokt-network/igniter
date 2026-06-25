import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow'
import { LoadKeysInRangeResult, providerActivities } from '@/activities'

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'
import { KeyState } from '@igniter/db/provider/enums'
import { classifyStatusResults } from '@/workflows/supplierStatusUtils'

type SupplierStatusByRange = {
  height: number
  minId: number
  maxId: number
  pageSize: number
  concurrency: number
  states: KeyState[]
}

export type StatusRangeResult = {
  staked: string[]
  unstaked: string[]
  fundsLow: string[]
  stakeLow: string[]
}

export async function SupplierStatusByRange(input: SupplierStatusByRange): Promise<StatusRangeResult> {
  log.info('SupplierStatusByRange: execution started', { minId: input.minId, maxId: input.maxId })
  const { loadKeysInRange, upsertSupplierStatus } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '10s',
      retry: {
        maximumAttempts: 10,
      },
    })

  const limit = pLimit(input.concurrency ?? 50);

  const rows: LoadKeysInRangeResult = await loadKeysInRange(input);

  log.debug('SupplierStatusByRange: Loaded keys from range', {
    ...input,
    keysCount: rows.length,
  })

  const emptyResult: StatusRangeResult = { staked: [], unstaked: [], fundsLow: [], stakeLow: [] }

  if(rows.length === 0) {
    log.warn('SupplierStatusByRange: No rows found for range', { minId: input.minId, maxId: input.maxId })
    return emptyResult
  }

  log.debug('SupplierStatusByRange: Loaded keys from range. Scheduling remediation activity for each key.', { minId: input.minId, maxId: input.maxId })

  const r = await Promise.allSettled(
    rows.map(r => limit(() =>
      upsertSupplierStatus({
        address: r.address,
        height: input.height,
      })
    ))
  );

  const allFailed = r.every(r => {
    if (r.status === 'rejected') {
      log.warn(`SupplierStatusByRange: Child workflow failed with: ${r.reason}`)
    }
    return r.status === 'rejected';
  })

  const failedReasons = r.filter(r => r.status === 'rejected').map((r) => {
    return r.reason;
  });

  if (allFailed) {
    throw new ApplicationFailure(
      'SupplierStatusByRange: All child workflows failed. Something is wrong.',
      'fatal_error',
      true,
      [failedReasons],
    )
  }

  const result = classifyStatusResults(r, rows.map((row) => row.address))

  log.info('SupplierStatusByRange: Execution Ended', { height: input.height, minId: input.minId, maxId: input.maxId, failedReasons })
  return result
}
