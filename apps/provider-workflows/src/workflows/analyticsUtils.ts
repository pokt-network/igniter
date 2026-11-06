import * as wf from '@temporalio/workflow'
import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'
import type { AnalyticsPlanMode } from '@/lib/analytics'
import { ANALYTICS_DAY_BUSY_WAIT, analyticsDayWorkflowId, onAnalyticsDayBusy } from '@/lib/analyticsDay'
import type { AnalyticsSyncDay, AnalyticsSyncDayResult } from '@/workflows/AnalyticsSyncDay'

/** Plan and prune only read or delete in the DB: retried with backoff over a transient DB error. */
export const ANALYTICS_PLAN_RETRY = { maximumAttempts: 5, initialInterval: '5s', backoffCoefficient: 2 }

const { planAnalyticsSync } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '60s',
  retry: ANALYTICS_PLAN_RETRY,
})

export type AnalyticsRunResult = {
  days: number
  /** Days skipped or given up because the other run was syncing them. */
  busy: number
  batches: number
  failed: number
  rows: number
  sessions: number
  members: number
  closed: number
  open: number
}

/**
 * Runs the day's AnalyticsSyncDay under its single id. Null when the other run holds the day: the sync skips it at once,
 * the backfill after waiting for it ANALYTICS_DAY_BUSY_ATTEMPTS times.
 */
async function syncDayOnce(mode: AnalyticsPlanMode, day: string): Promise<AnalyticsSyncDayResult | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await wf.executeChild<typeof AnalyticsSyncDay>('AnalyticsSyncDay', {
        args: [{ mode, day }],
        workflowId: analyticsDayWorkflowId(day),
      })
    } catch (e) {
      if ((e as Error)?.name !== 'WorkflowExecutionAlreadyStartedError') throw e
      const next = onAnalyticsDayBusy(mode, attempt)
      if (next === 'skip' || next === 'give_up') {
        log.info('runAnalyticsDays: day already being synced by another run', { mode, day, attempt, action: next })
        return null
      }
      await wf.sleep(ANALYTICS_DAY_BUSY_WAIT)
    }
  }
}

/**
 * Plans the run's days and syncs them one AnalyticsSyncDay child at a time, oldest first; each day child runs that
 * day's AnalyticsSyncBatch children. Only the day list passes through this workflow's history. A failed day child
 * counts as one failed batch and does not stop the other days; throws only when every batch of the run failed.
 */
export async function runAnalyticsDays(mode: AnalyticsPlanMode): Promise<AnalyticsRunResult> {
  const result: AnalyticsRunResult = { days: 0, busy: 0, batches: 0, failed: 0, rows: 0, sessions: 0, members: 0, closed: 0, open: 0 }

  const { indexerConfigured, days } = await planAnalyticsSync({ mode })
  if (!indexerConfigured || days.length === 0) return result
  result.days = days.length

  const failedDays: unknown[] = []
  for (const day of days) {
    try {
      const d = await syncDayOnce(mode, day)
      if (d === null) {
        result.busy += 1
        continue
      }
      result.batches += d.batches
      result.failed += d.failed
      result.rows += d.rows
      result.sessions += d.sessions
      result.members += d.members
      result.closed += d.closed
      result.open += d.open
    } catch (e) {
      failedDays.push({ day, reason: e })
      result.batches += 1
      result.failed += 1
    }
  }

  if (result.failed > 0) log.warn('runAnalyticsDays: some analytics batches failed', { mode, failed: result.failed, failedDays })
  if (result.batches > 0 && result.failed === result.batches) {
    throw new ApplicationFailure('runAnalyticsDays: all analytics batches failed', 'fatal_error', true, [failedDays])
  }
  log.info('runAnalyticsDays: Execution Ended', { mode, ...result })
  return result
}
