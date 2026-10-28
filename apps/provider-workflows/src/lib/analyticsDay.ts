import type { AnalyticsPlanMode } from '@/lib/analytics'

/*
 * Who syncs a day: pure helpers for the analytics workflows (no runtime import, safe in the workflow sandbox).
 */

/**
 * The one AnalyticsSyncDay id of a day, whichever run starts it (the scheduled sync or the backfill): Temporal refuses a
 * second start while one runs, so a day is never synced twice at once.
 */
export const analyticsDayWorkflowId = (day: string) => `AnalyticsSyncDay-${day}`

/** How long a backfill waits before trying again a day the scheduled sync is syncing, and how many times. */
export const ANALYTICS_DAY_BUSY_WAIT = '30s'
export const ANALYTICS_DAY_BUSY_ATTEMPTS = 40

/**
 * What a run does with a day already being synced by the other run. The sync skips it: the running one covers it
 * and the next sync comes back. The backfill waits and tries again, since only the backfill fills (day, supplier)
 * pairs never fetched; after ANALYTICS_DAY_BUSY_ATTEMPTS it gives the day up (a later backfill fills it).
 */
export function onAnalyticsDayBusy(mode: AnalyticsPlanMode, attempt: number): 'skip' | 'wait' | 'give_up' {
  if (mode === 'sync') return 'skip'
  return attempt < ANALYTICS_DAY_BUSY_ATTEMPTS ? 'wait' : 'give_up'
}
