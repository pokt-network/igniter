import { ApplicationFailure, Context, heartbeat, log } from '@temporalio/activity'
import {
  fetchSelectionCounts,
  fetchSupplierSessionFunnel,
  fetchSupplierSessionPage,
  ANALYTICS_MAX_SUPPLIERS,
  ANALYTICS_SESSION_PAGE_SIZE,
} from '@igniter/graphql/analytics'
import type {
  InsertAnalyticsServiceDay,
  InsertAnalyticsSession,
  InsertAnalyticsSessionMember,
  InsertAnalyticsSupplierDay,
  InsertAnalyticsSupplierDayState,
} from '@igniter/db/provider/schema'
import DAL from '@/lib/dal/DAL'
import {
  addDays,
  capSyncDays,
  chunk,
  closeThreshold,
  firstDayReopenedBy,
  ANALYTICS_VERIFIED_KEY_STATES,
  AnalyticsPlanMode,
  isAnalyticsDayClosed,
  lastFetchedByDay,
  oldestKeptDay,
  planAnalyticsDays,
  utcDay,
} from '@/lib/analytics'
import { semaphore } from '@/lib/semaphore'

/*
 * Analytics day sync activities. They write to the DB themselves and return only counts and the coverage bounds: rows never
 * travel through workflow history (payload size limits, and Temporal cannot serialize bigint).
 */

export type AnalyticsDayParams = { day: string; supplierIds: string[] }

export type AnalyticsFunnelDayResult = {
  rows: number
  services: number
  /** Rows of suppliers outside the batch the indexer returned anyway: dropped, never written. */
  dropped: number
  coveredFrom: string | null
  coveredTo: string | null
  gaps: number
}

export type AnalyticsSessionsDayResult = { pages: number; sessions: number; members: number; dropped: number }

export type AnalyticsCloseDayResult = { closed: number; open: number; reopened: number }

/**
 * DB work of the batch activities running at once in this worker. A day runs 12 batches at a time and each holds at
 * most one connection (its activities run one after another, one statement or transaction at a time), so a day alone
 * can ask for more than the worker's pool (PG_POOL_MAX, 10 by default), which the rest of the worker shares. With 6
 * slots the sync leaves 4 connections to everything else; the e2e averaged 3.4 busy connections, so the slots rarely
 * bind. A batch waits here in order instead of failing on the pool's connection timeout.
 */
export const ANALYTICS_DB_SLOTS = 6
const analyticsDb = semaphore(ANALYTICS_DB_SLOTS)

const toNumber = (v: string | null): number | null => (v === null ? null : Number(v))

/** The funnel request of a day: the day's sessions, with the coverage measured up to the close threshold. */
function funnelRange(day: string) {
  return { rangeStart: `${day}T00:00:00Z`, rangeEnd: closeThreshold(day).toISOString() }
}

export const analyticsActivities = (dal: DAL) => {
  async function loadPlan(mode: AnalyticsPlanMode) {
    const [settings, suppliers, states] = await Promise.all([
      dal.settings.loadSettings(),
      dal.keys.listAnalyticsSuppliers(ANALYTICS_VERIFIED_KEY_STATES),
      dal.analytics.listDayStates(),
    ])
    return {
      indexerApiUrl: settings?.indexerApiUrl || null,
      states,
      plan: planAnalyticsDays({
        suppliers,
        states,
        today: utcDay(new Date()),
        retentionDays: settings?.analyticsDayRetentionDays ?? 90,
        mode,
      }),
    }
  }

  async function indexerUrl(): Promise<string> {
    const settings = await dal.settings.loadSettings()
    if (!settings?.indexerApiUrl) {
      throw ApplicationFailure.nonRetryable('Analytics sync: indexerApiUrl is not configured', 'missing_indexer_url')
    }
    return settings.indexerApiUrl
  }

  /**
   * A write in one of the sync's DB slots. An attempt the server already timed out (it learns so at a heartbeat)
   * stops before it writes, checked once it holds the slot, so a wait for one does not hide a cancellation.
   */
  function write<T>(fn: () => Promise<T>): Promise<T> {
    return analyticsDb(async () => {
      Context.current().cancellationSignal.throwIfAborted()
      return fn()
    })
  }

  return {
    /**
     * The days the run has work for, oldest first (a sync run capped by capSyncDays). Empty (with a warning) when
     * the indexer URL is not set.
     * The suppliers of each day come from planAnalyticsDay, one day at a time, so no result carries every id at once.
     */
    async planAnalyticsSync(p: { mode: AnalyticsPlanMode }): Promise<{ indexerConfigured: boolean; days: string[] }> {
      const { indexerApiUrl, plan, states } = await loadPlan(p.mode)
      if (!indexerApiUrl) {
        log.warn('planAnalyticsSync: indexerApiUrl is not configured; the analytics sync does nothing', { mode: p.mode })
        return { indexerConfigured: false, days: [] }
      }
      const planned = [...plan.keys()]
      const days = p.mode === 'sync' ? capSyncDays(planned, lastFetchedByDay(plan, states)) : planned
      log.info('planAnalyticsSync: planned', { mode: p.mode, planned: planned.length, days: days.length })
      return { indexerConfigured: true, days }
    },

    /** The batches (at most 200 sorted supplier ids each) of one planned day. */
    async planAnalyticsDay(p: { mode: AnalyticsPlanMode; day: string }): Promise<{ batches: string[][] }> {
      const { plan } = await loadPlan(p.mode)
      return { batches: chunk(plan.get(p.day) ?? [], ANALYTICS_MAX_SUPPLIERS) }
    },

    /** Fetches the day's funnel of the batch and writes it (supplier rows + network_sessions per service). */
    async syncAnalyticsFunnelDay(p: AnalyticsDayParams): Promise<AnalyticsFunnelDayResult> {
      const url = await indexerUrl()
      const answer = await fetchSupplierSessionFunnel(url, { suppliers: p.supplierIds, ...funnelRange(p.day) })
      const batch = new Set(p.supplierIds)
      const fetchedAt = new Date()

      const rows: InsertAnalyticsSupplierDay[] = []
      const services = new Map<string, InsertAnalyticsServiceDay>()
      let dropped = 0
      for (const r of answer.rows) {
        // The request runs 2 h into the next day to measure coverage: keep only the day's own bucket.
        if (utcDay(new Date(r.bucketStart)) !== p.day) continue
        if (!batch.has(r.supplierId)) {
          dropped++
          continue
        }
        rows.push({
          day: p.day,
          supplierId: r.supplierId,
          serviceId: r.serviceId,
          seats: toNumber(r.seats),
          paid: toNumber(r.paid),
          settledZero: toNumber(r.settledZero),
          expired: toNumber(r.expired),
          discarded: toNumber(r.discarded),
          slashed: toNumber(r.slashed),
          idleOthersWorked: toNumber(r.idleOthersWorked),
          idleNoWork: toNumber(r.idleNoWork),
          unresolved: toNumber(r.unresolved),
          active: toNumber(r.active),
          paidUpokt: r.paidUpokt,
          equalShareUpokt: r.equalShareUpokt,
          relays: r.relays,
          computeUnits: r.computeUnits,
          sessionsWithSelected: toNumber(r.sessionsWithSelected),
          poolUpokt: r.poolUpokt,
          rosterSeats: toNumber(r.rosterSeats),
          firstHeight: toNumber(r.firstHeight),
          lastHeight: toNumber(r.lastHeight),
          fetchedAt,
        })
        // network_sessions is the service's, the same on every row of it: taken once, never summed.
        if (!services.has(r.serviceId)) {
          services.set(r.serviceId, {
            day: p.day,
            serviceId: r.serviceId,
            networkSessions: toNumber(r.networkSessions),
            fetchedAt,
          })
        }
      }
      if (dropped > 0) {
        log.warn('syncAnalyticsFunnelDay: dropped rows of suppliers outside the batch; the day stays open', { day: p.day, dropped })
      }

      await write(() => dal.analytics.replaceSupplierDays(p.day, p.supplierIds, rows, [...services.values()]))
      return {
        rows: rows.length,
        services: services.size,
        dropped,
        coveredFrom: answer.range.coveredFrom,
        coveredTo: answer.range.coveredTo,
        gaps: answer.range.gaps.length,
      }
    },

    /**
     * Pages the day's sessions of the batch (newest first, 1000 per page) and writes each page as it comes:
     * session totals, and member rows for the batch's own suppliers only. Then deletes the batch's rows of that
     * day the answer no longer has.
     */
    async syncAnalyticsSessionsDay(p: AnalyticsDayParams): Promise<AnalyticsSessionsDayResult> {
      const url = await indexerUrl()
      const batch = new Set(p.supplierIds)
      const range = { rangeStart: `${p.day}T00:00:00Z`, rangeEnd: `${addDays(p.day, 1)}T00:00:00Z` }
      let before: { height: string; sessionId: string } | undefined
      const result: AnalyticsSessionsDayResult = { pages: 0, sessions: 0, members: 0, dropped: 0 }
      // The (session, supplier) keys of this answer: the stale-row delete keeps exactly these. No timestamp decides a
      // deletion, so a late write of an abandoned earlier attempt can never make current rows look stale.
      const keepSessions: string[] = []
      const keepSuppliers: string[] = []

      for (;;) {
        const page = await fetchSupplierSessionPage(url, { suppliers: p.supplierIds, ...range, before })
        result.pages++
        const fetchedAt = new Date()
        const sessions: InsertAnalyticsSession[] = []
        const members: InsertAnalyticsSessionMember[] = []
        for (const r of page.rows) {
          const own: InsertAnalyticsSessionMember[] = []
          r.selectedSupplierIds.forEach((supplierId, i) => {
            if (!batch.has(supplierId)) {
              result.dropped++
              return
            }
            own.push({
              sessionId: r.sessionId,
              supplierId,
              day: p.day,
              state: r.selectedStates[i]!,
              paidUpokt: r.selectedPaidUpokt[i] ?? null,
              equalShareUpokt: r.selectedEqualShareUpokt[i] ?? null,
              fetchedAt,
            })
          })
          if (own.length === 0) continue
          members.push(...own)
          for (const m of own) {
            keepSessions.push(m.sessionId)
            keepSuppliers.push(m.supplierId)
          }
          sessions.push({
            sessionId: r.sessionId,
            day: p.day,
            serviceId: r.serviceId,
            applicationId: r.applicationId,
            startHeight: Number(r.startHeight),
            phase: r.phase,
            moneyMissing: r.moneyMissing,
            paidUpokt: r.paidUpokt,
            rosterSize: toNumber(r.rosterSize),
            candidates: toNumber(r.candidates),
            fetchedAt,
          })
        }
        await write(() => dal.analytics.upsertSessionPage(sessions, members))
        result.sessions += sessions.length
        result.members += members.length
        heartbeat(result)

        if (page.rows.length < ANALYTICS_SESSION_PAGE_SIZE) break
        const last = page.rows[page.rows.length - 1]!
        if (before && before.height === last.startHeight && before.sessionId === last.sessionId) {
          throw ApplicationFailure.nonRetryable('syncAnalyticsSessionsDay: the page cursor did not move', 'cursor_stuck')
        }
        before = { height: last.startHeight, sessionId: last.sessionId }
      }
      // Members of the batch this answer does not have (a reindex changed a roster), and the sessions left with no
      // member: removed, so stored = live as for the funnel rows.
      await write(() => dal.analytics.deleteStaleSessionRows(p.day, p.supplierIds, { sessionIds: keepSessions, supplierIds: keepSuppliers }))
      if (result.dropped > 0) log.warn('syncAnalyticsSessionsDay: dropped members outside the batch', { day: p.day, dropped: result.dropped })
      return result
    },

    /**
     * Applies the close rule to every (day, supplier) of the batch from the rows just written, and reopens the
     * closed days the coverage no longer reaches (an indexer rewind).
     */
    async closeAnalyticsDay(
      p: AnalyticsDayParams & { coveredFrom: string | null; coveredTo: string | null; gaps: number; dropped: number },
    ): Promise<AnalyticsCloseDayResult> {
      const inputs = await analyticsDb(() => dal.analytics.closeInputs(p.day, p.supplierIds))
      const fetchedAt = new Date()
      const coveredTo = p.coveredTo === null ? null : new Date(p.coveredTo)
      const mismatched: Array<{ supplierId: string; funnelSeats: number; memberRows: number }> = []
      const states: InsertAnalyticsSupplierDayState[] = p.supplierIds.map((supplierId) => {
        const funnelSeats = inputs.funnelSeats.get(supplierId) ?? 0
        const memberRows = inputs.memberRows.get(supplierId) ?? 0
        if (funnelSeats !== memberRows) mismatched.push({ supplierId, funnelSeats, memberRows })
        return {
          day: p.day,
          supplierId,
          closed: isAnalyticsDayClosed({
            day: p.day,
            coveredFrom: p.coveredFrom,
            coveredTo: p.coveredTo,
            gaps: p.gaps,
            dropped: p.dropped,
            activeSeats: inputs.activeSeats.get(supplierId) ?? 0,
            unsettledSessions: inputs.unsettledSessions.get(supplierId) ?? 0,
            funnelSeats,
            memberRows,
          }),
          coveredTo,
          fetchedAt,
        }
      })
      if (mismatched.length > 0) {
        log.warn('closeAnalyticsDay: member rows differ from the funnel seats; those suppliers stay open', {
          day: p.day,
          suppliers: mismatched.length,
          funnelSeats: mismatched.reduce((n, m) => n + m.funnelSeats, 0),
          memberRows: mismatched.reduce((n, m) => n + m.memberRows, 0),
          first: mismatched.slice(0, 3),
        })
      }
      await write(async () => {
        await dal.analytics.upsertDayStates(states)
        // The batch's last write: the day's syncing mark is fresh, so a slow day is not taken as abandoned.
        await dal.analytics.touchDaySyncing(p.day)
      })

      const reopenFrom = firstDayReopenedBy(funnelRange(p.day), p.coveredTo)
      const reopened = reopenFrom === null ? 0 : await write(() => dal.analytics.reopenClosedFrom(reopenFrom))
      if (reopened > 0) log.warn('closeAnalyticsDay: indexer coverage moved back; closed days reopened', { reopenFrom, reopened, coveredTo: p.coveredTo })

      const closed = states.filter((s) => s.closed).length
      return { closed, open: states.length - closed, reopened }
    },

    /** Marks the day syncing before its batches write: a failed rebuild then leaves it stale, never half-fresh. */
    async markAnalyticsDaySyncing(p: { day: string }): Promise<void> {
      await dal.analytics.markDaySyncing(p.day)
    },

    /** Rebuilds the day's breakdown rollups once its batches have written their member rows. */
    async rebuildAnalyticsDayRollup(p: { day: string }): Promise<{ rows: number }> {
      return { rows: (await dal.analytics.rebuildDayRollup(p.day, 'sync')).rows }
    },

    /**
     * Rebuilds the rollups of at most `max` stale days, oldest first (a day whose rollup is missing or was built
     * under another version). Returns how many it rebuilt, how many it skipped because a sync took them meanwhile,
     * and how many stay stale for the next call.
     */
    async rebuildStaleAnalyticsDayRollups(p: { max: number }): Promise<{ days: number; skipped: number; remaining: number }> {
      const stale = await dal.analytics.staleRollupDays()
      const days = stale.slice(0, Math.max(0, p.max))
      let skipped = 0
      // 'scheduled': a day a sync took meanwhile is skipped, never stamped over.
      for (const day of days) if ((await dal.analytics.rebuildDayRollup(day, 'scheduled')).skipped) skipped++
      if (days.length > 0) {
        log.info('rebuildStaleAnalyticsDayRollups: rebuilt', { days: days.length - skipped, skipped, first: days[0], last: days.at(-1), remaining: stale.length - days.length })
      }
      return { days: days.length - skipped, skipped, remaining: stale.length - days.length }
    },

    /**
     * Writes the selection reference of at most `max` closed days, newest first, leaving out `exclude` (see
     * selectionReferenceDays): per service, the day's latest session start, its candidates, the seats per draw, and
     * how many of the day's verified suppliers were eligible there, counted by the indexer from our ids only, at most
     * 200 per request. A day that fails is logged and returned in `failed`, so the caller can pass it in `exclude`
     * and older days still get their turn; a service counted above its candidates is not stored. A day is recorded
     * done even with no row to store (no verified supplier left on it, or every service over its candidates).
     */
    async syncAnalyticsSelectionReferences(p: { max: number; exclude?: string[] }): Promise<{ days: number; failed: string[]; remaining: number }> {
      const pending = await dal.analytics.selectionReferenceDays(p.exclude ?? [])
      const days = pending.slice(0, Math.max(0, p.max))
      if (days.length === 0) return { days: 0, failed: [], remaining: 0 }
      const url = await indexerUrl()
      const failed: string[] = []
      let written = 0
      for (const day of days) {
        try {
          const { version, services, suppliers } = await dal.analytics.selectionReferenceInputs(day)
          const references = services.map((s) => ({ serviceId: s.serviceId, height: s.height }))
          const ownEligible = new Map<string, number>()
          let caps: Record<number, number> = {}
          for (const [i, batch] of chunk(suppliers, ANALYTICS_MAX_SUPPLIERS).entries()) {
            // The seats per draw are the same for every batch: read once per day, with the first.
            const counts = await fetchSelectionCounts(url, { suppliers: batch, references, withCaps: i === 0 })
            for (const [serviceId, n] of Object.entries(counts.ownEligible)) ownEligible.set(serviceId, (ownEligible.get(serviceId) ?? 0) + n)
            if (i === 0) caps = counts.caps
            heartbeat({ day })
          }
          const fetchedAt = new Date()
          // No verified supplier left on the day: nothing to count, and the day is done with no rows.
          const rows = suppliers.length === 0 ? [] : services.map((s) => ({
            day,
            serviceId: s.serviceId,
            height: s.height,
            candidates: s.candidates,
            cap: caps[s.height]!,
            ownEligible: ownEligible.get(s.serviceId) ?? 0,
            version,
            fetchedAt,
          }))
          // More of ours than the session drew from cannot be: the model has no answer for it, so it is not stored.
          const over = rows.filter((r) => r.ownEligible > r.candidates)
          if (over.length > 0) {
            log.warn('syncAnalyticsSelectionReferences: more own eligible than candidates; not stored', {
              day,
              services: over.map((r) => ({ serviceId: r.serviceId, ownEligible: r.ownEligible, candidates: r.candidates })),
            })
          }
          const kept = rows.filter((r) => r.ownEligible <= r.candidates)
          if (await write(() => dal.analytics.replaceSelectionReferences(day, version, kept))) written++
          else log.info('syncAnalyticsSelectionReferences: the day changed while counting; counted again later', { day })
        } catch (e) {
          // A cancelled attempt stops here, never retried as a skipped day.
          Context.current().cancellationSignal.throwIfAborted()
          failed.push(day)
          log.warn('syncAnalyticsSelectionReferences: day failed; skipped this run', { day, error: (e as Error).message })
        }
      }
      log.info('syncAnalyticsSelectionReferences: written', { days: written, failed: failed.length, first: days[0], last: days.at(-1), remaining: pending.length - days.length })
      return { days: written, failed, remaining: pending.length - days.length }
    },

    /** Retention: deletes the analytics day rows older than `analytics_day_retention_days` (today counts as one). */
    async pruneAnalyticsDays(): Promise<{ before: string; deleted: number }> {
      const settings = await dal.settings.loadSettings()
      const before = oldestKeptDay(utcDay(new Date()), settings?.analyticsDayRetentionDays ?? 90)
      const deleted = await dal.analytics.deleteDaysBefore(before)
      if (deleted > 0) log.info('pruneAnalyticsDays: deleted', { before, deleted })
      return { before, deleted }
    },
  }
}
