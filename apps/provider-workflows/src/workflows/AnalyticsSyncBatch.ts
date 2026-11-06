import { proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'
import type { AnalyticsDayParams } from '@/activities/analytics'

const { syncAnalyticsFunnelDay, closeAnalyticsDay } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '2m',
  retry: { maximumAttempts: 3 },
})

const { syncAnalyticsSessionsDay } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '15m',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3 },
})

export type AnalyticsSyncBatchResult = {
  day: string
  suppliers: number
  rows: number
  sessions: number
  members: number
  closed: number
  open: number
  coveredTo: string | null
}

/**
 * Syncs one day of one batch (at most 200 supplier ids): the funnel, then the session pages, then the close
 * state of each (day, supplier). Returns counts only.
 */
export async function AnalyticsSyncBatch(p: AnalyticsDayParams): Promise<AnalyticsSyncBatchResult> {
  const funnel = await syncAnalyticsFunnelDay(p)
  const sessions = await syncAnalyticsSessionsDay(p)
  const close = await closeAnalyticsDay({
    ...p,
    coveredFrom: funnel.coveredFrom,
    coveredTo: funnel.coveredTo,
    gaps: funnel.gaps,
    dropped: funnel.dropped,
  })
  return {
    day: p.day,
    suppliers: p.supplierIds.length,
    rows: funnel.rows,
    sessions: sessions.sessions,
    members: sessions.members,
    closed: close.closed,
    open: close.open,
    coveredTo: funnel.coveredTo,
  }
}
