import { ANALYTICS_VERIFIED_KEY_STATES } from '@igniter/db/provider/schema'

/*
 * Pure planning and close rules of the analytics day sync (AnalyticsSync / AnalyticsBackfill). A day is a UTC calendar day
 * written `YYYY-MM-DD`: the day of the session start.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** A day closes only once the indexer's money coverage is this far past the day's end. */
export const ANALYTICS_CLOSE_MARGIN_MS = 2 * HOUR_MS

/** The verified-supplier key states; defined with the analytics tables, shared with the provider's Analytics page. */
export { ANALYTICS_VERIFIED_KEY_STATES }

export type AnalyticsPlanMode = 'sync' | 'backfill'

export type AnalyticsSupplier = { address: string; retiredAt: Date | null }

export type AnalyticsDayState = { day: string; supplierId: string; closed: boolean; fetchedAt: Date }

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

export function addDays(day: string, days: number): string {
  return utcDay(new Date(dayStart(day).getTime() + days * DAY_MS))
}

/** The oldest day kept: `retentionDays` days counting today. */
export function oldestKeptDay(today: string, retentionDays: number): string {
  return addDays(today, -(Math.max(1, Math.floor(retentionDays)) - 1))
}

/** Day end + the close margin: the coverage a day needs to close, and the end of its funnel request. */
export function closeThreshold(day: string): Date {
  return new Date(dayStart(day).getTime() + DAY_MS + ANALYTICS_CLOSE_MARGIN_MS)
}

export type AnalyticsCloseInput = {
  day: string
  /**
   * `covered_from` of that funnel request. The indexer clips it to max(history start, range start), so past the
   * day start it means the roster history starts mid-day: part of the day is not there.
   */
  coveredFrom: string | null
  /** `covered_to` of a funnel request that ended at closeThreshold(day). */
  coveredTo: string | null
  /** Funnel rows of suppliers outside the batch: an answer the selection does not explain is not final. */
  dropped: number
  /** Settlement gaps the indexer reported over that request. */
  gaps: number
  /** The supplier's seats of that day in sessions not settled yet (`active`, summed over its services). */
  activeSeats: number
  /** The supplier's sessions of that day not `settled`, or settled with `money_missing`. */
  unsettledSessions: number
  /** The supplier's seats of that day in the funnel (`seats + active`, summed over its services). */
  funnelSeats: number
  /** The supplier's member rows of that day: one per session it sat in, so equal to `funnelSeats` when complete. */
  memberRows: number
}

/**
 * A (day, supplier) is final when the coverage spans the whole day (from its start to 2 h past its end), none of
 * its seats is active, the range has no settlement gap, the answer had no row outside the batch, every one of its
 * sessions settled with its money (before that V is null or partial, and a `money_missing` session is recomputed
 * later), and its stored member rows are exactly its funnel seats (a row lost or left over keeps it open, so the
 * next sync fetches it again).
 */
export function isAnalyticsDayClosed(input: AnalyticsCloseInput): boolean {
  return input.coveredFrom !== null
    && Date.parse(input.coveredFrom) <= dayStart(input.day).getTime()
    && input.coveredTo !== null
    && Date.parse(input.coveredTo) >= closeThreshold(input.day).getTime()
    && input.gaps === 0
    && input.dropped === 0
    && input.activeSeats === 0
    && input.unsettledSessions === 0
    && input.memberRows === input.funnelSeats
}

/**
 * The first day whose closed state an answer over [rangeStart, rangeEnd) reopens, or null when the answer does
 * not show the coverage below rangeEnd. The indexer clips `covered_to` to the range, so it bounds the money
 * coverage only when it falls short of rangeEnd. A null `covered_to` says nothing about where the coverage is,
 * so it reopens nothing (the day itself just stays open). A closed day needs coverage up to its closeThreshold;
 * any day whose threshold lies past the coverage now (an indexer rewind) reopens.
 */
export function firstDayReopenedBy(range: { rangeStart: string; rangeEnd: string }, coveredTo: string | null): string | null {
  if (coveredTo === null) return null
  const coverage = Date.parse(coveredTo)
  if (coverage >= Date.parse(range.rangeEnd)) return null
  // closeThreshold(day) > coverage  <=>  day > coverage - (1 day + margin): the first such day is the next UTC day.
  return addDays(utcDay(new Date(coverage - DAY_MS - ANALYTICS_CLOSE_MARGIN_MS)), 1)
}

/**
 * The (day -> supplier ids) the sync fetches, both sorted ascending.
 * - sync: forward only. For each supplier, every day not closed from the first day it has a state for (the first
 *   run that saw it verified; today when it has none), up to today.
 * - backfill: for each supplier, every day of the retention window that has no state at all (never fetched).
 * Never a day before the retention window, and never a day after the key retired.
 */
export function planAnalyticsDays(input: {
  suppliers: AnalyticsSupplier[]
  states: AnalyticsDayState[]
  today: string
  retentionDays: number
  mode: AnalyticsPlanMode
}): Map<string, string[]> {
  const oldest = oldestKeptDay(input.today, input.retentionDays)
  const statesBySupplier = new Map<string, Map<string, boolean>>()
  for (const s of input.states) {
    let own = statesBySupplier.get(s.supplierId)
    if (!own) statesBySupplier.set(s.supplierId, (own = new Map()))
    own.set(s.day, s.closed)
  }

  const plan = new Map<string, string[]>()
  for (const supplier of input.suppliers) {
    const own = statesBySupplier.get(supplier.address) ?? new Map<string, boolean>()
    const retiredDay = supplier.retiredAt ? utcDay(supplier.retiredAt) : null
    const last = retiredDay !== null && retiredDay < input.today ? retiredDay : input.today

    let first: string
    if (input.mode === 'sync') {
      const seen = [...own.keys()].sort()[0] ?? input.today
      first = seen > oldest ? seen : oldest
    } else {
      first = oldest
    }

    for (let day = first; day <= last; day = addDays(day, 1)) {
      const closed = own.get(day)
      const wanted = input.mode === 'sync' ? closed !== true : closed === undefined
      if (!wanted) continue
      let ids = plan.get(day)
      if (!ids) plan.set(day, (ids = []))
      ids.push(supplier.address)
    }
  }

  const sorted = new Map<string, string[]>()
  for (const day of [...plan.keys()].sort()) sorted.set(day, plan.get(day)!.sort())
  return sorted
}

/**
 * Days one scheduled sync run fetches at most. A day can stay open for long (a session the indexer has not
 * settled, or settled with its money missing), and without a cap every such day would be fetched every run.
 */
export const ANALYTICS_SYNC_MAX_DAYS = 7

/**
 * Caps the days of a sync run (sorted ascending) to ANALYTICS_SYNC_MAX_DAYS: the two newest (today and yesterday,
 * the ones that change) always, then the open days fetched least recently, so every open day takes its turn
 * however long the oldest ones stay open. `lastFetchedAt` is a day's latest fetch (ms) over its planned
 * suppliers; a day absent from it was never fetched and goes first. Returns the kept days sorted ascending.
 */
export function capSyncDays(days: string[], lastFetchedAt: Map<string, number>): string[] {
  if (days.length <= ANALYTICS_SYNC_MAX_DAYS) return days
  const newest = days.slice(-2)
  const rest = days.slice(0, -2)
    .map((day) => ({ day, at: lastFetchedAt.get(day) ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => a.at - b.at || a.day.localeCompare(b.day))
    .slice(0, ANALYTICS_SYNC_MAX_DAYS - 2)
    .map((d) => d.day)
  return [...rest, ...newest].sort()
}

/**
 * The latest fetch (ms) of each planned day over the suppliers planned for it. A day none of whose planned
 * suppliers has a state is absent: never fetched.
 */
export function lastFetchedByDay(plan: Map<string, string[]>, states: AnalyticsDayState[]): Map<string, number> {
  const fetched = new Map<string, number>()
  for (const s of states) fetched.set(`${s.day}|${s.supplierId}`, s.fetchedAt.getTime())
  const out = new Map<string, number>()
  for (const [day, ids] of plan) {
    for (const id of ids) {
      const at = fetched.get(`${day}|${id}`)
      if (at !== undefined && at > (out.get(day) ?? Number.NEGATIVE_INFINITY)) out.set(day, at)
    }
  }
  return out
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
