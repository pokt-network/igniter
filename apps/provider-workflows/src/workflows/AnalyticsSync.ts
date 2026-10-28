import { log, proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'
import { ANALYTICS_PLAN_RETRY, AnalyticsRunResult, runAnalyticsDays } from '@/workflows/analyticsUtils'

const { pruneAnalyticsDays } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '2m',
  retry: ANALYTICS_PLAN_RETRY,
})

const { rebuildStaleAnalyticsDayRollups } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '5m',
  retry: ANALYTICS_PLAN_RETRY,
})

// Best-effort and indexer-bound: a short retry, and a heartbeat per request so a hung call fails early.
const { syncAnalyticsSelectionReferences } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '2m',
  retry: { ...ANALYTICS_PLAN_RETRY, maximumAttempts: 2 },
})

/** Stale days rebuilt per activity call (each about a second), and calls per run. */
const ROLLUP_DAYS_PER_CALL = 10
const ROLLUP_CALLS_PER_RUN = 12

/** Days per selection reference call (one indexer request per 200 suppliers each), and calls per run. */
const REFERENCE_DAYS_PER_CALL = 5
const REFERENCE_CALLS_PER_RUN = 12

/**
 * Scheduled analytics day sync, forward only: today and every day still open of the provider's verified suppliers,
 * from the first run that saw each one. History before that comes only from AnalyticsBackfill.
 *
 * Retention runs first on every run; it deletes rows only when the UTC day moves the cutoff, so it acts daily.
 * It is best-effort: a failed prune is logged and retried next run, and never keeps the day sync from running.
 * After the days, the rollups of stale days (missing, or built under another version of the day) are rebuilt, a few
 * days per activity call (best-effort too: until then the page counts those days from the member rows). Last, the
 * selection references of closed days that have none yet, newest first (best-effort: the What-if card waits for them).
 */
export async function AnalyticsSync(): Promise<AnalyticsRunResult & { pruned: number; rollupDays: number; referenceDays: number }> {
  let pruned = 0
  try {
    pruned = (await pruneAnalyticsDays()).deleted
  } catch (e) {
    log.warn('AnalyticsSync: retention prune failed; retried next run', { error: (e as Error).message })
  }
  const result = await runAnalyticsDays('sync')
  let rollupDays = 0
  try {
    for (let call = 0; call < ROLLUP_CALLS_PER_RUN; call++) {
      const r = await rebuildStaleAnalyticsDayRollups({ max: ROLLUP_DAYS_PER_CALL })
      rollupDays += r.days
      if (r.remaining === 0) break
    }
  } catch (e) {
    log.warn('AnalyticsSync: rollup rebuild failed; retried next run', { error: (e as Error).message })
  }
  let referenceDays = 0
  // Days that failed in this run: left out of the later calls, so they never block the older ones.
  const failedDays: string[] = []
  try {
    for (let call = 0; call < REFERENCE_CALLS_PER_RUN; call++) {
      const r = await syncAnalyticsSelectionReferences({ max: REFERENCE_DAYS_PER_CALL, exclude: failedDays })
      referenceDays += r.days
      failedDays.push(...r.failed)
      if (r.remaining === 0) break
    }
  } catch (e) {
    log.warn('AnalyticsSync: selection references failed; retried next run', { error: (e as Error).message })
  }
  return { ...result, pruned, rollupDays, referenceDays }
}
