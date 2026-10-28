'use server'

import { type ActionResult, withRequireOwner } from '@/lib/utils/actionUtils'
import { getTemporalClient, getTemporalConfig } from '@/lib/temporal'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import {
  analyticsBreakdown,
  analyticsDayCoverage,
  analyticsDayServiceTotals,
  analyticsHasOtherSuppliers,
  analyticsOldestDay,
  analyticsSelectionReferences,
  getAnalyticsSession,
  listAnalyticsKeys,
  listAnalyticsServices,
  listAnalyticsSessions,
  ANALYTICS_BREAKDOWN_DIMENSIONS,
  ANALYTICS_SESSION_PHASES,
  type AnalyticsBreakdownDimension,
  type AnalyticsFilter,
  type AnalyticsGroupRow,
  type AnalyticsSelectionReferenceRow,
  type AnalyticsSessionMember,
  type AnalyticsSessionPhase,
  type AnalyticsSessionRow,
} from '@/lib/dal/analytics'
import { clampAnalyticsRange, coverageOf, defaultPeriodDays, analyticsPeriod, analyticsRangeBounds, missingDayPairs, periodOptions } from '@/lib/analytics/coverage'
import { summarize, utcDay, type AnalyticsSummary } from '@/lib/analytics/math'
import { getLogger } from '@igniter/logger'
import { cache } from 'react'

const log = getLogger(['provider', 'analytics'])

/** One fixed id: Temporal refuses a second AnalyticsBackfill while one is running. */
const ANALYTICS_BACKFILL_WORKFLOW_ID = 'AnalyticsBackfill'

/**
 * What the Analytics page asks for, always over every verified supplier of the provider: the last N days, or a
 * custom [from, to] range of UTC days (which wins when both are set); and optionally some services.
 */
export type AnalyticsFilters = {
  days: number
  from?: string | null
  to?: string | null
  services: string[] | null
}

export type AnalyticsOptions = {
  retentionDays: number
  periodOptions: number[]
  /** The period the page opens with when the URL names none: 7 days, or the retention when shorter. */
  defaultDays: number
  /** The days a custom range may take: from the oldest stored day (never before retention) to today, UTC. */
  rangeBounds: { min: string; max: string }
  services: string[]
}

export type AnalyticsHeader = {
  from: string
  to: string
  suppliers: number
  services: number
  lastClosedDay: string | null
  openDays: number
  missing: { pairs: number; days: number }
}

/*
 * The reads every action repeats, deduplicated within one server request (the page's first render runs the options,
 * header and summary in one): React cache() lasts a request, so nothing goes stale across requests.
 */
const retentionDays = cache(async (): Promise<number> => {
  const settings = await getApplicationSettings()
  return settings.analyticsDayRetentionDays ?? 90
})
const analyticsKeys = cache(listAnalyticsKeys)
const oldestDay = cache(analyticsOldestDay)

/**
 * The DB filter of the page's filters: the period capped by retention, over every verified supplier. `wholeSessions`
 * costs one more query, so only the reads that use it ask for it.
 */
async function resolve(filters: AnalyticsFilters, { wholeSessions = true }: { wholeSessions?: boolean } = {}) {
  const [keys, retention, oldestDataDay] = await Promise.all([analyticsKeys(), retentionDays(), oldestDay()])
  const suppliers = keys.map((k) => k.address).sort()
  const today = utcDay(new Date())
  const custom = filters.from && filters.to
    ? clampAnalyticsRange({ from: filters.from, to: filters.to }, { today, retentionDays: retention, oldestDataDay })
    : null
  const period = custom ?? analyticsPeriod(today, filters.days, retention)
  const services = filters.services && filters.services.length > 0 ? filters.services : null
  const filter: AnalyticsFilter = {
    from: period.from,
    to: period.to,
    services,
    suppliers,
    wholeSessions: wholeSessions && !(await analyticsHasOtherSuppliers(period.from, period.to, suppliers)),
  }
  return { keys, period, filter }
}

async function isBackfillRunning(): Promise<boolean> {
  try {
    const description = await getTemporalClient().workflow.getHandle(ANALYTICS_BACKFILL_WORKFLOW_ID).describe()
    return description.status.name === 'RUNNING'
  } catch {
    // Never started (not found), or Temporal unreachable: nothing to show as running.
    return false
  }
}

export async function GetAnalyticsOptions(): Promise<ActionResult<AnalyticsOptions>> {
  return withRequireOwner(async () => {
    const [retention, oldestDataDay] = await Promise.all([retentionDays(), oldestDay()])
    const today = utcDay(new Date())
    const oldest = analyticsPeriod(today, retention, retention).from
    return {
      retentionDays: retention,
      periodOptions: periodOptions(retention),
      defaultDays: defaultPeriodDays(retention),
      rangeBounds: analyticsRangeBounds({ today, retentionDays: retention, oldestDataDay }),
      services: await listAnalyticsServices(oldest),
    }
  })
}

export async function GetAnalyticsHeader(filters: AnalyticsFilters): Promise<ActionResult<AnalyticsHeader>> {
  return withRequireOwner(async () => {
    const { keys, period, filter } = await resolve(filters, { wholeSessions: false })
    const [coverage, allServices] = await Promise.all([
      analyticsDayCoverage(period.from, period.to, filter.suppliers),
      listAnalyticsServices(period.from),
    ])
    return {
      from: period.from,
      to: period.to,
      suppliers: keys.length,
      services: filters.services?.length || allServices.length,
      ...coverageOf(coverage),
      missing: missingDayPairs({
        suppliers: keys,
        coverage,
        from: period.from,
        to: period.to,
      }),
    }
  })
}

/** The period a read covered, as the server resolved it: labels and filenames use it, never another read's. */
export type AnalyticsPeriod = { from: string; to: string }
/** The summary, plus per service of the period the What-if card's selection reference (its latest closed day). */
export type AnalyticsSummaryView = AnalyticsSummary & { period: AnalyticsPeriod; selection: AnalyticsSelectionReferenceRow[] }

export async function GetAnalyticsSummary(filters: AnalyticsFilters): Promise<ActionResult<AnalyticsSummaryView>> {
  return withRequireOwner(async () => {
    const { filter, period } = await resolve(filters)
    const [totals, coverage, selection] = await Promise.all([
      analyticsDayServiceTotals(filter),
      analyticsDayCoverage(filter.from, filter.to, filter.suppliers),
      analyticsSelectionReferences(filter),
    ])
    const summary = summarize(totals, new Set(coverage.filter((c) => c.closed && c.states > 0).map((c) => c.day)))
    if (summary.presenceErrorDays.length > 0) {
      log.error('Analytics presence: closed days with more own sessions than network sessions; shown clamped to 100%', {
        days: summary.presenceErrorDays,
      })
    }
    return { ...summary, period: { from: period.from, to: period.to }, selection }
  })
}

export async function GetAnalyticsBreakdown(
  filters: AnalyticsFilters,
  dimension: AnalyticsBreakdownDimension,
): Promise<ActionResult<{ period: AnalyticsPeriod; rows: AnalyticsGroupRow[] }>> {
  return withRequireOwner(async () => {
    if (!ANALYTICS_BREAKDOWN_DIMENSIONS.includes(dimension)) throw new Error(`Unknown dimension ${dimension}`)
    const { filter, period } = await resolve(filters)
    return { period: { from: period.from, to: period.to }, rows: await analyticsBreakdown(filter, dimension) }
  })
}

export async function ListAnalyticsSessions(
  filters: AnalyticsFilters,
  page: { pageIndex: number; pageSize: number; phase: AnalyticsSessionPhase },
): Promise<ActionResult<{ total: number; rows: AnalyticsSessionRow[] }>> {
  return withRequireOwner(async () => {
    if (!ANALYTICS_SESSION_PHASES.includes(page.phase)) throw new Error(`Unknown phase ${page.phase}`)
    const { filter } = await resolve(filters)
    const limit = Math.min(Math.max(1, Math.floor(page.pageSize)), 200)
    return listAnalyticsSessions(filter, { offset: Math.max(0, Math.floor(page.pageIndex)) * limit, limit, phase: page.phase })
  })
}

/** One session as the page sees it: only its members that are the provider's verified suppliers, on the selected services. */
export async function GetAnalyticsSession(
  filters: AnalyticsFilters,
  sessionId: string,
): Promise<ActionResult<{ session: AnalyticsSessionRow; members: AnalyticsSessionMember[] } | null>> {
  return withRequireOwner(async () => {
    const { filter } = await resolve(filters)
    return getAnalyticsSession(filter, sessionId)
  })
}

/** Whether the latest AnalyticsBackfill run is still running (a completed, failed or never-started one is not). */
export async function GetAnalyticsBackfillStatus(): Promise<ActionResult<{ running: boolean }>> {
  return withRequireOwner(async () => ({ running: await isBackfillRunning() }))
}

/**
 * Starts the manual analytics backfill: fills the (day, supplier) pairs of the retention window that have no data yet,
 * oldest first. A start while one is already running is a no-op (`started: false`).
 */
export async function StartAnalyticsBackfill(): Promise<ActionResult<{ started: boolean }>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const { taskQueue } = getTemporalConfig()
    try {
      await client.workflow.start('AnalyticsBackfill', {
        taskQueue,
        workflowId: ANALYTICS_BACKFILL_WORKFLOW_ID,
        args: [],
      })
      return { started: true }
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'WorkflowExecutionAlreadyStartedError') return { started: false }
      throw e
    }
  })
}
