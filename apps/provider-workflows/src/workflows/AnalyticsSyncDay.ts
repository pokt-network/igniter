import * as wf from '@temporalio/workflow'
import { log, proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'
import type { AnalyticsPlanMode } from '@/lib/analytics'
import type { AnalyticsSyncBatch } from '@/workflows/AnalyticsSyncBatch'
import { ANALYTICS_PLAN_RETRY } from '@/workflows/analyticsUtils'

// we built to commonjs and p-limit for esm support
// @ts-ignore
import pLimit from 'p-limit'

/** AnalyticsSyncBatch children running at once: the day is indexer-bound, so one wave is the fastest. */
const ANALYTICS_BATCH_CONCURRENCY = 12

const { planAnalyticsDay, markAnalyticsDaySyncing, rebuildAnalyticsDayRollup } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '60s',
  retry: ANALYTICS_PLAN_RETRY,
})

export type AnalyticsSyncDayResult = {
  day: string
  batches: number
  failed: number
  rows: number
  sessions: number
  members: number
  closed: number
  open: number
}

/**
 * Syncs one planned day: plans its batches (at most 200 supplier ids each) and runs a AnalyticsSyncBatch child per
 * batch, at most 12 at a time (one wave for a typical day), then rebuilds the day's breakdown rollups (marked syncing first, so a failure leaves the day stale, never half-fresh). The day's ids live only in this child's
 * history, never in the parent's. Failed batches are counted, not thrown: the parent decides.
 */
export async function AnalyticsSyncDay(p: { mode: AnalyticsPlanMode; day: string }): Promise<AnalyticsSyncDayResult> {
  const result: AnalyticsSyncDayResult = { day: p.day, batches: 0, failed: 0, rows: 0, sessions: 0, members: 0, closed: 0, open: 0 }
  const { batches } = await planAnalyticsDay(p)
  result.batches = batches.length
  // Until the rebuild below succeeds, readers count this day from its member rows.
  if (batches.length > 0) await markAnalyticsDaySyncing({ day: p.day })

  const { runId } = wf.workflowInfo()
  const limitBatches = pLimit(ANALYTICS_BATCH_CONCURRENCY)
  const settled = await Promise.allSettled(batches.map((supplierIds, i) =>
    limitBatches(() => wf.executeChild<typeof AnalyticsSyncBatch>('AnalyticsSyncBatch', {
      args: [{ day: p.day, supplierIds }],
      workflowId: `AnalyticsSyncBatch-${p.day}-${i}-${runId}`,
    }))))

  const failedReasons: unknown[] = []
  for (const s of settled) {
    if (s.status === 'rejected') {
      failedReasons.push(s.reason)
      continue
    }
    result.rows += s.value.rows
    result.sessions += s.value.sessions
    result.members += s.value.members
    result.closed += s.value.closed
    result.open += s.value.open
  }
  result.failed = failedReasons.length
  if (result.failed > 0) log.warn('AnalyticsSyncDay: some AnalyticsSyncBatch children failed', { ...p, failed: result.failed, failedReasons })
  // From whatever the batches stored, failed ones included. Best-effort: the day's data is stored either way, and
  // AnalyticsSync rebuilds any day left without a current rollup.
  if (batches.length > 0) {
    try {
      await rebuildAnalyticsDayRollup({ day: p.day })
    } catch (e) {
      log.warn('AnalyticsSyncDay: rollup rebuild failed; AnalyticsSync rebuilds it later', { ...p, error: (e as Error).message })
    }
  }
  return result
}
