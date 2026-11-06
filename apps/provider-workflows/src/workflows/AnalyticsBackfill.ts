import { runAnalyticsDays, AnalyticsRunResult } from '@/workflows/analyticsUtils'

/**
 * Manual fill of the retention window: every (day, supplier) with no state yet, oldest day first, through the
 * same AnalyticsSyncDay / AnalyticsSyncBatch children. Started by the provider admin with the fixed workflow id
 * `AnalyticsBackfill`, so a second start while one runs is refused by Temporal.
 */
export async function AnalyticsBackfill(): Promise<AnalyticsRunResult> {
  return runAnalyticsDays('backfill')
}
