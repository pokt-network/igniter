import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { HealState, WatchdogStateStore } from '@igniter/temporal'
import type { WatchdogHealState as WatchdogHealStateView } from '@igniter/temporal/workflow-view'
import { watchdogHealStateTable as providerWatchdogHealStateTable } from './provider/schema'

/**
 * The `watchdog_heal_state` drizzle table. The provider and middleman schemas
 * declare this table byte-for-byte identically, so either app's table is
 * structurally assignable to this type; we anchor on the provider schema's
 * definition purely to derive the column shape.
 */
export type WatchdogHealStateTable = typeof providerWatchdogHealStateTable

// Loose over the schema generic: only the query-builder surface is used here,
// and both apps pass a fully-typed `NodePgDatabase<AppSchema>` at the call site.
type Db = NodePgDatabase<Record<string, unknown>>

/**
 * Worker-side self-heal state store for the Temporal schedule watchdog,
 * parameterized by the drizzle `db` client + the app's `watchdogHealStateTable`.
 *
 * The SQL semantics here are the single source of truth for BOTH apps; each
 * app's `Watchdog` DAL is a thin wrapper that binds its own table. Behavior is
 * preserved exactly from the previous per-app implementations, including the
 * write-ahead UPSERT keying, `compensateInjectedTrigger`'s `GREATEST(... , 0)`
 * clamp, and `observedUnhealthy: false` in `resetLadder`.
 */
export function createWatchdogHealStateStore(
  db: Db,
  table: WatchdogHealStateTable,
): WatchdogStateStore {
  return {
    async getState(scheduleId: string): Promise<HealState | undefined> {
      const [row] = await db
        .select()
        .from(table)
        .where(eq(table.scheduleId, scheduleId))
        .limit(1)
      return row as HealState | undefined
    },

    async bumpUnstuck(scheduleId: string): Promise<HealState> {
      const [row] = await db
        .insert(table)
        .values({ scheduleId, unstucks: 1 })
        .onConflictDoUpdate({
          target: table.scheduleId,
          set: { unstucks: sql`${table.unstucks} + 1` },
        })
        .returning()
      return row as HealState
    },

    async bumpInjectedTrigger(scheduleId: string, at: Date): Promise<HealState> {
      const [row] = await db
        .insert(table)
        .values({ scheduleId, injectedTriggers: 1, lastHealTriggerAt: at })
        .onConflictDoUpdate({
          target: table.scheduleId,
          set: {
            injectedTriggers: sql`${table.injectedTriggers} + 1`,
            lastHealTriggerAt: at,
          },
        })
        .returning()
      return row as HealState
    },

    async compensateInjectedTrigger(scheduleId: string): Promise<void> {
      await db
        .update(table)
        .set({ injectedTriggers: sql`GREATEST(${table.injectedTriggers} - 1, 0)` })
        .where(eq(table.scheduleId, scheduleId))
    },

    async setUnhealthy(scheduleId: string, unhealthy: boolean): Promise<void> {
      await db
        .insert(table)
        .values({ scheduleId, unhealthy })
        .onConflictDoUpdate({ target: table.scheduleId, set: { unhealthy } })
    },

    async setObservedUnhealthy(scheduleId: string, observed: boolean): Promise<void> {
      await db
        .insert(table)
        .values({ scheduleId, observedUnhealthy: observed })
        .onConflictDoUpdate({
          target: table.scheduleId,
          set: { observedUnhealthy: observed },
        })
    },

    async resetOnRecreate(scheduleId: string): Promise<void> {
      await db
        .insert(table)
        .values({ scheduleId, lastActionCount: 0, injectedTriggers: 0 })
        .onConflictDoUpdate({
          target: table.scheduleId,
          set: { lastActionCount: 0, injectedTriggers: 0 },
        })
    },

    async resetLadder(scheduleId: string, lastActionCount: number): Promise<void> {
      await db
        .insert(table)
        .values({ scheduleId, unstucks: 0, unhealthy: false, observedUnhealthy: false, injectedTriggers: 0, lastActionCount })
        .onConflictDoUpdate({
          target: table.scheduleId,
          set: { unstucks: 0, unhealthy: false, observedUnhealthy: false, injectedTriggers: 0, lastActionCount },
        })
    },

    async recordRecreate(scheduleId: string): Promise<void> {
      await db
        .insert(table)
        .values({ scheduleId, recreations: 1, lastRecreatedAt: new Date() })
        .onConflictDoUpdate({
          target: table.scheduleId,
          set: {
            recreations: sql`${table.recreations} + 1`,
            lastRecreatedAt: new Date(),
          },
        })
    },
  }
}

/**
 * Read-only view of `watchdog_heal_state` for the admin Schedules panel,
 * parameterized by the drizzle `db` client + the app's `watchdogHealStateTable`.
 *
 * Queries via the typed drizzle table (not raw `SELECT *`) so timestamps use the
 * SAME codec as the worker's write path — drizzle reads tz-less columns as UTC,
 * so there is no local/UTC drift (#26/#32). Errors are allowed to propagate to
 * the action's error path: swallowing them would render a DB outage as
 * "all schedules healthy" — exactly the failure this panel exists to surface
 * (#9/M9). The table ships in this PR's migration, so a missing table is not a
 * case to tolerate.
 */
export async function readWatchdogHealState(
  db: Db,
  table: WatchdogHealStateTable,
): Promise<WatchdogHealStateView[]> {
  const rows = await db.select().from(table)
  return rows.map((r) => ({
    scheduleId: r.scheduleId,
    unstucks: r.unstucks,
    injectedTriggers: r.injectedTriggers,
    lastHealTriggerAt: r.lastHealTriggerAt ? r.lastHealTriggerAt.toISOString() : null,
    lastActionCount: r.lastActionCount,
    unhealthy: r.unhealthy,
    observedUnhealthy: r.observedUnhealthy,
    recreations: r.recreations,
    lastRecreatedAt: r.lastRecreatedAt ? r.lastRecreatedAt.toISOString() : null,
  }))
}
