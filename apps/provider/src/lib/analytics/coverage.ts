import { addDays, utcDay } from './math'

/*
 * What the stored data covers: closed and open days, and the (day, supplier) pairs never fetched, which only the
 * manual backfill fills.
 */

/** Per day of the period: the scope's state rows, and whether every one of them is closed. */
export type AnalyticsDayCoverage = { day: string; states: number; closed: boolean }

/** The days the page can show: the last `days` days counting today, never more than the retention keeps. */
export function analyticsPeriod(today: string, days: number, retentionDays: number): { from: string; to: string; days: number } {
  const n = Math.max(1, Math.min(Math.floor(days), Math.floor(retentionDays)))
  return { from: addDays(today, -(n - 1)), to: today, days: n }
}

/**
 * A custom [from, to] range, clamped to what can be shown: never before the oldest stored day nor the retention
 * window's first day, never after today (UTC), and from <= to. Returns null for a malformed day.
 */
export function clampAnalyticsRange(
  range: { from: string; to: string },
  bounds: { today: string; retentionDays: number; oldestDataDay: string | null },
): { from: string; to: string; days: number } | null {
  const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  if (!isDay(range.from) || !isDay(range.to)) return null
  const { min, max } = analyticsRangeBounds(bounds)
  const clamp = (d: string) => (d < min ? min : d > max ? max : d)
  const to = clamp(range.to)
  const fromClamped = clamp(range.from)
  const from = fromClamped > to ? to : fromClamped
  return { from, to, days: Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 }
}

/** The first and last day a custom range may take. */
export function analyticsRangeBounds(bounds: { today: string; retentionDays: number; oldestDataDay: string | null }): { min: string; max: string } {
  const retentionStart = analyticsPeriod(bounds.today, bounds.retentionDays, bounds.retentionDays).from
  const oldest = bounds.oldestDataDay && bounds.oldestDataDay > retentionStart ? bounds.oldestDataDay : retentionStart
  return { min: oldest > bounds.today ? bounds.today : oldest, max: bounds.today }
}

/** The period choices: 7, 30 and 90 days, capped by the retention (which is offered itself when below 90). */
/** The period the page opens with: the last 7 days, or the whole retention when it is shorter. */
export function defaultPeriodDays(retentionDays: number): number {
  return Math.min(7, Math.max(1, Math.floor(retentionDays)))
}

export function periodOptions(retentionDays: number): number[] {
  const r = Math.max(1, Math.floor(retentionDays))
  const opts = [7, 30, 90].filter((d) => d <= r)
  if (!opts.includes(Math.min(r, 90))) opts.push(Math.min(r, 90))
  return opts.sort((a, b) => a - b)
}

/**
 * The (day, supplier) pairs of [from, to] that have no state row: never synced. Each day expects every supplier
 * of the scope except those retired before it; `coverage` gives the state rows the scope has per day.
 */
export function missingDayPairs(input: {
  suppliers: Array<{ address: string; retiredAt: Date | null }>
  coverage: AnalyticsDayCoverage[]
  from: string
  to: string
}): { pairs: number; days: number } {
  const present = new Map(input.coverage.map((c) => [c.day, c.states]))
  const retiredDays = input.suppliers.map((s) => (s.retiredAt ? utcDay(s.retiredAt) : null))
  let pairs = 0
  let days = 0
  for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
    const expected = retiredDays.filter((r) => r === null || r >= day).length
    const missing = Math.max(0, expected - (present.get(day) ?? 0))
    pairs += missing
    if (missing > 0) days++
  }
  return { pairs, days }
}

/** The coverage line: the last day whose every stored (day, supplier) is closed, and the days with an open one. */
export function coverageOf(coverage: AnalyticsDayCoverage[]): { lastClosedDay: string | null; openDays: number } {
  const stored = coverage.filter((c) => c.states > 0)
  return {
    lastClosedDay: stored.filter((c) => c.closed).map((c) => c.day).sort().at(-1) ?? null,
    openDays: stored.filter((c) => !c.closed).length,
  }
}

const DAY_MS = 86_400_000
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Periods up to this many days chart one point per day; longer ones one per week. */
export const ANALYTICS_DAILY_CHART_MAX_DAYS = 14

/** Whether a period charts by day (short) or by week. */
export function chartsByDay(from: string, to: string): boolean {
  return (dayMs(to) - dayMs(from)) / DAY_MS + 1 <= ANALYTICS_DAILY_CHART_MAX_DAYS
}

/**
 * A week's label: the 7 days from `weekStart`, clipped to the period: "6–12 Sep", "29 Sep–5 Oct", or "25 Oct" when
 * only one day of it is in the period.
 */
export function weekRangeLabel(weekStart: string, from: string, to: string): string {
  const start = weekStart < from ? from : weekStart
  const seventh = addDays(weekStart, 6)
  const end = seventh > to ? to : seventh
  const part = (day: string, month: boolean) =>
    `${Number(day.slice(8, 10))}${month ? ` ${MONTHS[Number(day.slice(5, 7)) - 1]}` : ''}`
  if (start === end) return part(start, true)
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  return `${part(start, !sameMonth)}–${part(end, true)}`
}

/**
 * The period cut into 7-day blocks from its first day, the last one shorter when the period is not a whole number
 * of weeks: the weeks of the earnings chart, as @mykyal's fleet analysis draws them. Each with its label ("6–12 Sep").
 */
export function periodWeeks(from: string, to: string): Array<{ start: string; end: string; label: string }> {
  const weeks: Array<{ start: string; end: string; label: string }> = []
  for (let start = from; start <= to; start = new Date(dayMs(start) + 7 * DAY_MS).toISOString().slice(0, 10)) {
    const sixth = new Date(dayMs(start) + 6 * DAY_MS).toISOString().slice(0, 10)
    const end = sixth > to ? to : sixth
    weeks.push({ start, end, label: weekRangeLabel(start, start, end) })
  }
  return weeks
}
