import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import {
  ANALYTICS_KEY_OWNER_SQL,
  ANALYTICS_ROLLUP_ABANDONED_AFTER,
  ANALYTICS_ROLLUP_SYNCING,
  ANALYTICS_VERIFIED_KEY_STATES,
  analyticsDayRollupTable,
  analyticsDayVersionSql,
  analyticsStaleRollupDaysSql,
  analyticsOwnerDayTable,
  analyticsSelectionReferenceDayTable,
  analyticsSelectionReferenceTable,
  analyticsServiceDayTable,
  analyticsSessionMemberTable,
  analyticsSessionTable,
  analyticsSupplierDayStateTable,
  analyticsSupplierDayTable,
  InsertAnalyticsSelectionReference,
  InsertAnalyticsServiceDay,
  InsertAnalyticsSession,
  InsertAnalyticsSessionMember,
  InsertAnalyticsSupplierDay,
  InsertAnalyticsSupplierDayState,
} from '@igniter/db/provider/schema'
import type { Logger } from '@igniter/logger'
import { and, eq, getTableColumns, gte, inArray, lt, sql } from 'drizzle-orm'
import type { AnalyticsDayState } from '@/lib/analytics'
import { chunk } from '@/lib/analytics'

/** Rows per INSERT: keeps the widest table (analytics_supplier_day, 23 columns) under Postgres' 65535 parameters. */
const INSERT_CHUNK = 2000

/** `SET col = excluded.col` for every column of a table (its getTableColumns) except the conflict target. */
function excludedSet(columns: Record<string, { name: string }>, keys: string[]): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  for (const [name, column] of Object.entries(columns)) {
    if (!keys.includes(name)) set[name] = sql.raw(`excluded."${column.name}"`)
  }
  return set
}

/** Who rebuilds a day: its own sync (always allowed) or the scheduled rebuild (never over a sync still writing). */
export type AnalyticsRollupMode = 'sync' | 'scheduled'

/** Thrown inside the rebuild transaction to roll it back when a sync took the day meanwhile. */
class DayTakenBySync extends Error {}

/** A serialization failure (SQLSTATE 40001), raised by REPEATABLE READ when a concurrent commit touched the same row. */
export function isSerializationFailure(e: unknown): boolean {
  const code = (x: unknown) => (x as { code?: string } | null)?.code
  return code(e) === '40001' || code((e as { cause?: unknown } | null)?.cause) === '40001'
}

const bySupplierService = (a: InsertAnalyticsSupplierDay, b: InsertAnalyticsSupplierDay) =>
  a.supplierId.localeCompare(b.supplierId) || a.serviceId.localeCompare(b.serviceId)

/**
 * The analytics day tables. Every write upserts in key order (session id first for sessions), so two children writing
 * the same day at once lock rows in the same order and never deadlock.
 */
export default class Analytics {
  logger: Logger

  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async listDayStates(): Promise<AnalyticsDayState[]> {
    return this.dbClient.db
      .select({
        day: analyticsSupplierDayStateTable.day,
        supplierId: analyticsSupplierDayStateTable.supplierId,
        closed: analyticsSupplierDayStateTable.closed,
        fetchedAt: analyticsSupplierDayStateTable.fetchedAt,
      })
      .from(analyticsSupplierDayStateTable)
  }

  /**
   * Writes the funnel of `supplierIds` for `day` in one transaction: upserts its rows, deletes the rows of those
   * suppliers on that day the answer no longer has, and upserts each service's `network_sessions`. The rows kept
   * are the (supplier, service) keys of the answer, never a time cut: the wall clock can step back between two
   * attempts.
   */
  async replaceSupplierDays(
    day: string,
    supplierIds: string[],
    rows: InsertAnalyticsSupplierDay[],
    services: InsertAnalyticsServiceDay[],
  ): Promise<void> {
    const sortedRows = [...rows].sort(bySupplierService)
    const sortedServices = [...services].sort((a, b) => a.serviceId.localeCompare(b.serviceId))
    await this.dbClient.db.transaction(async (tx) => {
      for (const part of chunk(sortedRows, INSERT_CHUNK)) {
        await tx.insert(analyticsSupplierDayTable).values(part).onConflictDoUpdate({
          target: [analyticsSupplierDayTable.day, analyticsSupplierDayTable.supplierId, analyticsSupplierDayTable.serviceId],
          set: excludedSet(getTableColumns(analyticsSupplierDayTable), ['day', 'supplierId', 'serviceId']),
        })
      }
      await tx.delete(analyticsSupplierDayTable).where(and(
        eq(analyticsSupplierDayTable.day, day),
        inArray(analyticsSupplierDayTable.supplierId, supplierIds),
        sql`(${analyticsSupplierDayTable.supplierId}, ${analyticsSupplierDayTable.serviceId}) not in (
          select * from unnest(${sql.param(sortedRows.map((r) => r.supplierId))}::text[], ${sql.param(sortedRows.map((r) => r.serviceId))}::text[]))`,
      ))
      if (sortedServices.length > 0) {
        await tx.insert(analyticsServiceDayTable).values(sortedServices).onConflictDoUpdate({
          target: [analyticsServiceDayTable.day, analyticsServiceDayTable.serviceId],
          set: excludedSet(getTableColumns(analyticsServiceDayTable), ['day', 'serviceId']),
        })
      }
    })
  }

  /** Writes one session-list page in one transaction: the sessions, then their members, both in session_id order. */
  async upsertSessionPage(sessions: InsertAnalyticsSession[], members: InsertAnalyticsSessionMember[]): Promise<void> {
    if (sessions.length === 0) return
    const sortedSessions = [...sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    const sortedMembers = [...members].sort((a, b) =>
      a.sessionId.localeCompare(b.sessionId) || a.supplierId.localeCompare(b.supplierId))
    await this.dbClient.db.transaction(async (tx) => {
      for (const part of chunk(sortedSessions, INSERT_CHUNK)) {
        await tx.insert(analyticsSessionTable).values(part).onConflictDoUpdate({
          target: analyticsSessionTable.sessionId,
          // The own_* rollup belongs to the day rebuild, not to a page of the indexer's answer.
          set: excludedSet(getTableColumns(analyticsSessionTable), ['sessionId', 'ownMembers', 'ownPaidUpokt', 'ownEqualShareUpokt']),
        })
      }
      for (const part of chunk(sortedMembers, INSERT_CHUNK)) {
        await tx.insert(analyticsSessionMemberTable).values(part).onConflictDoUpdate({
          target: [analyticsSessionMemberTable.sessionId, analyticsSessionMemberTable.supplierId],
          set: excludedSet(getTableColumns(analyticsSessionMemberTable), ['sessionId', 'supplierId']),
        })
      }
    })
  }

  /**
   * Deletes the member rows of `supplierIds` on `day` that are not in `keep` (the (session, supplier) keys of the
   * answer just stored: the rows it no longer has), then the sessions of `day` left with no member. Only that set
   * decides, never a timestamp, so a late write of another attempt cannot get current rows deleted. A session and its
   * members are written in one transaction, so another batch's session is never seen without its members.
   */
  async deleteStaleSessionRows(day: string, supplierIds: string[], keep: { sessionIds: string[]; supplierIds: string[] }): Promise<void> {
    await this.dbClient.db.transaction(async (tx) => {
      await tx.execute(sql`
        delete from ${analyticsSessionMemberTable}
        where ${analyticsSessionMemberTable.day} = ${day}
          and ${analyticsSessionMemberTable.supplierId} = any(${sql.param(supplierIds)}::text[])
          and (${analyticsSessionMemberTable.sessionId}, ${analyticsSessionMemberTable.supplierId}) not in (
            select * from unnest(${sql.param(keep.sessionIds)}::text[], ${sql.param(keep.supplierIds)}::text[]))`)
      await tx.delete(analyticsSessionTable).where(and(
        eq(analyticsSessionTable.day, day),
        sql`not exists (select 1 from ${analyticsSessionMemberTable} where ${analyticsSessionMemberTable.sessionId} = ${analyticsSessionTable.sessionId})`,
      ))
    })
  }

  /**
   * What the close rule needs from the stored rows of `day`, per supplier: its active seats and funnel seats, and
   * its member rows and those of sessions not settled (or settled with money missing). Suppliers with no row are
   * absent from the maps (zero).
   *
   * The member count walks the batch's member rows once and finds each session by its primary key, whatever the
   * statistics say. It runs while the day is being written, before any ANALYZE has seen it: a shape that matches
   * sessions by day then rescans the whole day's sessions for every member row (19 s against 0.12 s, measured on a
   * 245k-member day), and twelve of those held the worker's whole pool. Once analyzed, a plain join turns into a
   * parallel hash over every stored session.
   */
  async closeInputs(day: string, supplierIds: string[]): Promise<{
    activeSeats: Map<string, number>
    funnelSeats: Map<string, number>
    memberRows: Map<string, number>
    unsettledSessions: Map<string, number>
  }> {
    const funnel = await this.dbClient.db
      .select({
        supplierId: analyticsSupplierDayTable.supplierId,
        activeSeats: sql<number>`coalesce(sum(${analyticsSupplierDayTable.active}), 0)::int`,
        // Either count can be null on a row: a null side counts as 0, never drops the row's other side.
        funnelSeats: sql<number>`coalesce(sum(coalesce(${analyticsSupplierDayTable.seats}, 0) + coalesce(${analyticsSupplierDayTable.active}, 0)), 0)::int`,
      })
      .from(analyticsSupplierDayTable)
      .where(and(eq(analyticsSupplierDayTable.day, day), inArray(analyticsSupplierDayTable.supplierId, supplierIds)))
      .groupBy(analyticsSupplierDayTable.supplierId)

    // `offset 0` keeps the lateral lookup from being flattened into a join, so the plan is the same with or
    // without statistics: a primary-key lookup per member row of the batch. As a plain join, an analyzed table gets
    // a parallel hash join over every stored session instead.
    const members = await this.dbClient.db.execute<{ supplier_id: string; member_rows: number; unsettled: number }>(sql`
      select m.supplier_id, count(*)::int as member_rows, (count(*) filter (where u.unsettled))::int as unsettled
      from ${analyticsSessionMemberTable} m
      cross join lateral (
        select s.phase <> 'settled' or s.money_missing as unsettled
        from ${analyticsSessionTable} s where s.session_id = m.session_id
        offset 0) u
      where m.day = ${day} and m.supplier_id = any(${sql.param(supplierIds)}::text[])
      group by m.supplier_id`)

    return {
      activeSeats: new Map(funnel.map((r) => [r.supplierId, Number(r.activeSeats)])),
      funnelSeats: new Map(funnel.map((r) => [r.supplierId, Number(r.funnelSeats)])),
      memberRows: new Map(members.rows.map((r) => [String(r.supplier_id), Number(r.member_rows)])),
      unsettledSessions: new Map(members.rows.map((r) => [String(r.supplier_id), Number(r.unsettled)])),
    }
  }

  async upsertDayStates(states: InsertAnalyticsSupplierDayState[]): Promise<void> {
    if (states.length === 0) return
    const sorted = [...states].sort((a, b) => a.day.localeCompare(b.day) || a.supplierId.localeCompare(b.supplierId))
    for (const part of chunk(sorted, INSERT_CHUNK)) {
      await this.dbClient.db.insert(analyticsSupplierDayStateTable).values(part).onConflictDoUpdate({
        target: [analyticsSupplierDayStateTable.day, analyticsSupplierDayStateTable.supplierId],
        set: excludedSet(getTableColumns(analyticsSupplierDayStateTable), ['day', 'supplierId']),
      })
    }
  }

  /** Reopens every closed (day, supplier) from `day` on, for every supplier: the indexer's coverage moved back. */
  async reopenClosedFrom(day: string): Promise<number> {
    const result = await this.dbClient.db
      .update(analyticsSupplierDayStateTable)
      .set({ closed: false })
      .where(and(eq(analyticsSupplierDayStateTable.closed, true), gte(analyticsSupplierDayStateTable.day, day)))
    return result.rowCount ?? 0
  }

  /**
   * Marks the day syncing before a sync writes it: readers count it live, and the scheduled rebuild leaves it alone
   * until the sync's own rebuild (or, if that never comes, until the mark is abandoned).
   */
  async markDaySyncing(day: string): Promise<void> {
    await this.dbClient.db.execute(sql`
      insert into ${analyticsDayRollupTable} (day, version, built_at) values (${day}, ${ANALYTICS_ROLLUP_SYNCING}, now())
      on conflict (day) do update set version = excluded.version, built_at = excluded.built_at`)
  }

  /**
   * Rebuilds the breakdown rollups of `day` from its stored member rows of verified keys: the distinct sessions per
   * (service, owner), and each session's own members, Y and B; then records the day's rollup under its version
   * (even with no rows, so such a day is not rebuilt again). One REPEATABLE READ transaction that reads the version
   * before the rows it stamps, from the same snapshot. `sync` (the day's own sync, at its end) replaces its syncing
   * mark; `scheduled` first locks the mark and skips a day a sync holds, and returns `skipped` when a sync took the
   * day during the rebuild (nothing is written then). Returns the owner rows written.
   */
  /** Runs inside the scheduled rebuild's transaction right after its lock: a no-op, overridden by tests to race a sync. */
  protected async afterScheduledLock(): Promise<void> {}

  async rebuildDayRollup(day: string, mode: AnalyticsRollupMode): Promise<{ rows: number; skipped: boolean }> {
    try {
      return await this.dbClient.db.transaction(async (tx) => {
        if (mode === 'scheduled') {
          // First, before any read: lock the day's mark. A sync marking the day later waits for this commit and then
          // overwrites the version; a mark committed before this snapshot shows here and the day is left alone.
          const mark = await tx.execute<{ syncing: boolean; abandoned: boolean }>(sql`
            select version = ${ANALYTICS_ROLLUP_SYNCING} as syncing,
                   built_at < now() - ${ANALYTICS_ROLLUP_ABANDONED_AFTER}::interval as abandoned
            from ${analyticsDayRollupTable} where day = ${day} for update`)
          const row = mark.rows[0]
          if (row?.syncing && !row.abandoned) return { rows: 0, skipped: true }
          await this.afterScheduledLock()
        }
        const version = await tx.execute<{ version: string }>(sql`
          select ${sql.raw(analyticsDayVersionSql('d.day'))} as version from (select ${day}::date as day) d`)
        await tx.delete(analyticsOwnerDayTable).where(eq(analyticsOwnerDayTable.day, day))
        const result = await tx.execute(sql`
          insert into ${analyticsOwnerDayTable} (day, service_id, owner_address, sessions)
          select m.day, s.service_id, ${sql.raw(ANALYTICS_KEY_OWNER_SQL)} as owner, count(distinct m.session_id)::int
          from ${analyticsSessionMemberTable} m
          join ${analyticsSessionTable} s on s.session_id = m.session_id
          join keys k on k.address = m.supplier_id
          where m.day = ${day} and k.state = any(${sql.param(ANALYTICS_VERIFIED_KEY_STATES)}::address_states[])
          group by 1, 2, 3
          order by 2, 3`)
        // Sessions in session_id order, as every other writer of analytics_session locks them.
        await tx.execute(sql`
          update ${analyticsSessionTable} s
          set own_members = t.x, own_paid_upokt = t.y, own_equal_share_upokt = t.b
          from (
            select s2.session_id, count(m.supplier_id)::int as x, sum(m.paid_upokt) as y, sum(m.equal_share_upokt) as b
            from ${analyticsSessionTable} s2
            left join ${analyticsSessionMemberTable} m on m.session_id = s2.session_id
              and m.supplier_id in (select k.address from keys k where k.state = any(${sql.param(ANALYTICS_VERIFIED_KEY_STATES)}::address_states[]))
            where s2.day = ${day}
            group by s2.session_id
            order by s2.session_id
          ) t
          where s.session_id = t.session_id`)
        // The sync's own rebuild replaces its mark; the scheduled one never stamps over a live mark (belt and braces:
        // a mark inserted after this snapshot fails the upsert with a serialization error instead).
        const stamped = await tx.execute(sql`
          insert into ${analyticsDayRollupTable} (day, version, built_at)
          values (${day}, ${String(version.rows[0]?.version)}, now())
          on conflict (day) do update set version = excluded.version, built_at = excluded.built_at
          ${mode === 'scheduled'
            ? sql`where ${analyticsDayRollupTable}.version <> ${ANALYTICS_ROLLUP_SYNCING}
                    or ${analyticsDayRollupTable}.built_at < now() - ${ANALYTICS_ROLLUP_ABANDONED_AFTER}::interval`
            : sql``}`)
        if (mode === 'scheduled' && (stamped.rowCount ?? 0) === 0) throw new DayTakenBySync()
        return { rows: result.rowCount ?? 0, skipped: false }
      }, { isolationLevel: 'repeatable read' })
    } catch (e) {
      if (mode === 'scheduled' && (e instanceof DayTakenBySync || isSerializationFailure(e))) return { rows: 0, skipped: true }
      throw e
    }
  }

  /** A batch of a syncing day finished: its mark is fresh again, so the day is not taken as abandoned. */
  async touchDaySyncing(day: string): Promise<void> {
    await this.dbClient.db.execute(sql`
      update ${analyticsDayRollupTable} set built_at = now() where day = ${day} and version = ${ANALYTICS_ROLLUP_SYNCING}`)
  }

  /** The days the scheduled rebuild takes, oldest first: the shared stale-day rule (analyticsStaleRollupDaysSql). */
  async staleRollupDays(): Promise<string[]> {
    const result = await this.dbClient.db.execute<{ day: string }>(analyticsStaleRollupDaysSql(null, 'rebuild'))
    return result.rows.map((r) => String(r.day))
  }

  /**
   * The days whose selection reference is to be written, newest first (the page reads the latest), leaving out
   * `exclude`: every stored (day, supplier) closed, a session with candidates stored, and not done under the day's
   * current version (analytics_selection_reference_day; analyticsDayVersionSql: a supplier the backfill added later,
   * or a key that left the verified states, changes it).
   */
  async selectionReferenceDays(exclude: string[] = []): Promise<string[]> {
    const result = await this.dbClient.db.execute<{ day: string }>(sql`
      select d.day::text as day
      from (select day from ${analyticsSupplierDayStateTable} group by day having bool_and(closed)) d
      where exists (select 1 from ${analyticsSessionTable} a where a.day = d.day and a.candidates is not null)
        and not (d.day::text = any(${sql.param(exclude)}::text[]))
        and not exists (
          select 1 from ${analyticsSelectionReferenceDayTable} r
          where r.day = d.day and r.version = ${sql.raw(analyticsDayVersionSql('d.day'))})
      order by 1 desc`)
    return result.rows.map((r) => String(r.day))
  }

  /**
   * The inputs of a day's selection reference, from one snapshot: the day's version, per service its latest stored
   * session start of the day with that session's candidates, and the day's suppliers whose key is verified now (its
   * state rows), whose eligible count the indexer gives.
   */
  async selectionReferenceInputs(day: string): Promise<{
    version: string
    services: Array<{ serviceId: string; height: number; candidates: number }>
    suppliers: string[]
  }> {
    return this.dbClient.db.transaction(async (tx) => {
      const version = await tx.execute<{ version: string }>(sql`
        select ${sql.raw(analyticsDayVersionSql('d.day'))} as version from (select ${day}::date as day) d`)
      const services = await tx.execute<{ service_id: string; start_height: string; candidates: string }>(sql`
        select distinct on (service_id) service_id, start_height, candidates
        from ${analyticsSessionTable}
        where day = ${day} and candidates is not null
        order by service_id, start_height desc, candidates desc`)
      const suppliers = await tx.execute<{ supplier_id: string }>(sql`
        select st.supplier_id
        from ${analyticsSupplierDayStateTable} st
        join keys k on k.address = st.supplier_id
        where st.day = ${day} and k.state = any(${sql.param(ANALYTICS_VERIFIED_KEY_STATES)}::address_states[])
        order by 1`)
      return {
        version: String(version.rows[0]?.version),
        services: services.rows.map((r) => ({ serviceId: String(r.service_id), height: Number(r.start_height), candidates: Number(r.candidates) })),
        suppliers: suppliers.rows.map((r) => String(r.supplier_id)),
      }
    }, { isolationLevel: 'repeatable read' })
  }

  /**
   * Replaces the day's selection reference rows and records the day done under `version` (with no rows too), only if
   * the day still has that version; otherwise writes nothing (false) and the day stays pending for the next call.
   */
  async replaceSelectionReferences(day: string, version: string, rows: InsertAnalyticsSelectionReference[]): Promise<boolean> {
    return this.dbClient.db.transaction(async (tx) => {
      const current = await tx.execute<{ version: string }>(sql`
        select ${sql.raw(analyticsDayVersionSql('d.day'))} as version from (select ${day}::date as day) d`)
      if (String(current.rows[0]?.version) !== version) return false
      await tx.delete(analyticsSelectionReferenceTable).where(eq(analyticsSelectionReferenceTable.day, day))
      if (rows.length > 0) await tx.insert(analyticsSelectionReferenceTable).values(rows)
      await tx.insert(analyticsSelectionReferenceDayTable).values({ day, version, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: analyticsSelectionReferenceDayTable.day, set: { version, fetchedAt: new Date() } })
      return true
    })
  }

  /** Retention: deletes the rows of every analytics table whose day is before `day`. Returns the rows deleted. */
  async deleteDaysBefore(day: string): Promise<number> {
    let deleted = 0
    for (const table of [
      analyticsDayRollupTable,
      analyticsOwnerDayTable,
      analyticsSelectionReferenceDayTable,
      analyticsSelectionReferenceTable,
      analyticsSessionMemberTable,
      analyticsSessionTable,
      analyticsSupplierDayTable,
      analyticsServiceDayTable,
      analyticsSupplierDayStateTable,
    ]) {
      const result = await this.dbClient.db.delete(table).where(lt(table.day, day))
      deleted += result.rowCount ?? 0
    }
    return deleted
  }
}
