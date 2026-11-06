import {
  bigint,
  boolean,
  integer,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql, type SQL } from 'drizzle-orm'
import { KeyState } from './enums'

/*
 * Per-day copy of the indexer's session funnel for the provider's own suppliers, written by the AnalyticsSync /
 * AnalyticsBackfill workflows. `day` is the UTC day of the session start. Amounts are upokt (numeric, read as
 * strings); counts and heights fit a JS number. No foreign key to `keys`: a retired key's days stay.
 */

/**
 * The key states counted as the provider's own, verified suppliers for the analytics tables: every state a staked key
 * can be in. Keys that never got staked (imported, available, delivered, staking, stake_failed) would only make
 * empty calls. Holding the key is the proof of control. Read by the sync (provider-workflows) and the Analytics page.
 */
export const ANALYTICS_VERIFIED_KEY_STATES: KeyState[] = [
  KeyState.Staked,
  KeyState.Unstaking,
  KeyState.Unstaked,
  KeyState.MissingStake,
  KeyState.AttentionNeeded,
  KeyState.RemediationFailed,
]

/**
 * One row of the funnel per (day, supplier, service). `sessions_with_selected`, `pool_upokt` and
 * `roster_seats` are the values of this supplier alone: two suppliers in one session each carry that session's
 * full V and K, so they are never summed across suppliers.
 */
export const analyticsSupplierDayTable = pgTable('analytics_supplier_day', {
  day: date('day', { mode: 'string' }).notNull(),
  supplierId: varchar('supplier_id', { length: 255 }).notNull(),
  serviceId: varchar('service_id', { length: 255 }).notNull(),
  seats: bigint('seats', { mode: 'number' }),
  paid: bigint('paid', { mode: 'number' }),
  settledZero: bigint('settled_zero', { mode: 'number' }),
  expired: bigint('expired', { mode: 'number' }),
  discarded: bigint('discarded', { mode: 'number' }),
  slashed: bigint('slashed', { mode: 'number' }),
  idleOthersWorked: bigint('idle_others_worked', { mode: 'number' }),
  idleNoWork: bigint('idle_no_work', { mode: 'number' }),
  unresolved: bigint('unresolved', { mode: 'number' }),
  active: bigint('active', { mode: 'number' }),
  paidUpokt: numeric('paid_upokt'),
  equalShareUpokt: numeric('equal_share_upokt'),
  relays: numeric('relays'),
  computeUnits: numeric('compute_units'),
  sessionsWithSelected: bigint('sessions_with_selected', { mode: 'number' }),
  poolUpokt: numeric('pool_upokt'),
  rosterSeats: bigint('roster_seats', { mode: 'number' }),
  firstHeight: bigint('first_height', { mode: 'number' }),
  lastHeight: bigint('last_height', { mode: 'number' }),
  fetchedAt: timestamp('fetched_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.supplierId, t.serviceId] }),
  index('analytics_supplier_day_supplier_day_idx').on(t.supplierId, t.day),
])

/** The settled sessions of a service on a day (`network_sessions`): one value per (day, service), never summed. */
export const analyticsServiceDayTable = pgTable('analytics_service_day', {
  day: date('day', { mode: 'string' }).notNull(),
  serviceId: varchar('service_id', { length: 255 }).notNull(),
  networkSessions: bigint('network_sessions', { mode: 'number' }),
  fetchedAt: timestamp('fetched_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.serviceId] }),
])

/**
 * A session with at least one of the provider's suppliers in its roster. Its totals (V = `paid_upokt`,
 * K = `roster_size`) are the same in every batch that sees it, so a later batch overwrites them, never adds.
 */
export const analyticsSessionTable = pgTable('analytics_session', {
  sessionId: varchar('session_id', { length: 255 }).primaryKey(),
  day: date('day', { mode: 'string' }).notNull(),
  serviceId: varchar('service_id', { length: 255 }).notNull(),
  applicationId: varchar('application_id', { length: 255 }).notNull(),
  startHeight: bigint('start_height', { mode: 'number' }).notNull(),
  phase: varchar('phase', { length: 32 }).notNull(),
  moneyMissing: boolean('money_missing').notNull(),
  paidUpokt: numeric('paid_upokt'),
  rosterSize: bigint('roster_size', { mode: 'number' }),
  candidates: bigint('candidates', { mode: 'number' }),
  fetchedAt: timestamp('fetched_at').notNull(),
  /**
   * The provider's verified members of the session, their Y and B, set by the day rebuild (see analytics_day_rollup) so
   * the per-session breakdowns read this table instead of the member rows. Read only for days with a current rollup
   * row; a sync's upsert keeps them.
   */
  ownMembers: integer('own_members'),
  ownPaidUpokt: numeric('own_paid_upokt'),
  ownEqualShareUpokt: numeric('own_equal_share_upokt'),
}, (t) => [
  index('analytics_session_day_idx').on(t.day),
  // The Sessions list pages newest first.
  index('analytics_session_start_height_idx').on(t.startHeight, t.sessionId),
])

/** One of the provider's own suppliers in a session's roster, and how its seat ended. */
export const analyticsSessionMemberTable = pgTable('analytics_session_member', {
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  supplierId: varchar('supplier_id', { length: 255 }).notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  state: varchar('state', { length: 32 }).notNull(),
  paidUpokt: numeric('paid_upokt'),
  equalShareUpokt: numeric('equal_share_upokt'),
  fetchedAt: timestamp('fetched_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.supplierId] }),
  index('analytics_session_member_supplier_day_idx').on(t.supplierId, t.day),
  index('analytics_session_member_day_idx').on(t.day),
])

/**
 * Sync state per (day, supplier). A closed day is final and is not fetched again; it reopens when the indexer's
 * coverage moves back below its end (a rewind).
 */
export const analyticsSupplierDayStateTable = pgTable('analytics_supplier_day_state', {
  day: date('day', { mode: 'string' }).notNull(),
  supplierId: varchar('supplier_id', { length: 255 }).notNull(),
  closed: boolean('closed').notNull().default(false),
  coveredTo: timestamp('covered_to'),
  fetchedAt: timestamp('fetched_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.supplierId] }),
])

/** The owner a key (aliased `k`) counts under in the owner breakdown: its stake owner, else the owner it was delivered to. */
export const ANALYTICS_KEY_OWNER_SQL = `coalesce(nullif(k."stakeOwner", ''), nullif(k."ownerAddress", ''), '')`

/**
 * The rollup version of one day, as an SQL subquery over `dayExpr` (an SQL expression of a date): a digest of the
 * day's stored suppliers (its state rows) with, for each, its owner while its key is verified, or '-' otherwise. It
 * changes only when that day's member set or one of its suppliers' owner or verified state changes: a new key with no
 * history there leaves it alone.
 */
export function analyticsDayVersionSql(dayExpr: string): string {
  const verified = ANALYTICS_VERIFIED_KEY_STATES.map((s) => `'${s}'`).join(', ')
  return `(select md5(coalesce(string_agg(st.supplier_id || ':' ||
      case when k.state in (${verified}) then ${ANALYTICS_KEY_OWNER_SQL} else '-' end, ',' order by st.supplier_id), ''))
    from analytics_supplier_day_state st left join keys k on k.address = st.supplier_id
    where st.day = ${dayExpr})`
}

/**
 * Distinct sessions per (day, service, owner) of the stored member rows, rebuilt with the day's rollup (see
 * analytics_day_rollup). Counting distinct sessions per owner from the member rows reads every member of the period;
 * this table keeps the owner breakdown fast.
 */
export const analyticsOwnerDayTable = pgTable('analytics_owner_day', {
  day: date('day', { mode: 'string' }).notNull(),
  serviceId: varchar('service_id', { length: 255 }).notNull(),
  ownerAddress: varchar('owner_address', { length: 255 }).notNull(),
  sessions: integer('sessions').notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.serviceId, t.ownerAddress] }),
])

/**
 * One row per day for its rollups (analytics_owner_day and analytics_session.own_*): the day's version (analyticsDayVersionSql)
 * they were built under, or ANALYTICS_ROLLUP_SYNCING while a sync of the day writes (`built_at` = when it started). A day
 * sync marks it syncing before writing and its rebuild writes the version last, so a sync or rebuild that fails
 * leaves the day syncing: readers count it from its member rows, and the scheduled rebuild takes it once abandoned.
 */
export const analyticsDayRollupTable = pgTable('analytics_day_rollup', {
  day: date('day', { mode: 'string' }).primaryKey(),
  version: varchar('version', { length: 32 }).notNull(),
  builtAt: timestamp('built_at').notNull(),
})

/** analytics_day_rollup.version of a day a sync is writing. */
export const ANALYTICS_ROLLUP_SYNCING = 'syncing'

/**
 * A syncing mark older than this is an abandoned sync: the scheduled rebuild takes the day. Every batch refreshes the
 * mark when it finishes, and one batch's worst case (funnel 3 x 2m, sessions 3 x 15m, close 3 x 2m) is about an hour,
 * so this is twice that: no batch of the day finished for 2 hours.
 */
export const ANALYTICS_ROLLUP_ABANDONED_AFTER = '2 hours'

/**
 * The stale-day rule, shared by the Analytics page (`read`) and the scheduled rebuild (`rebuild`), as one query
 * returning `day` (text), oldest first. A day with stored data (analytics_session or state rows; in `range` when given)
 * is stale when it has no rollup row, a row of another version than the day has now, or a syncing mark. For
 * `rebuild` a syncing mark counts only once abandoned, so a sync still writing is never rebuilt under it.
 */
export function analyticsStaleRollupDaysSql(range: { from: string; to: string } | null, purpose: 'read' | 'rebuild'): SQL {
  const inRange = range ? sql`where day between ${range.from} and ${range.to}` : sql``
  const syncingStale = purpose === 'read'
    ? sql`r.version = ${ANALYTICS_ROLLUP_SYNCING}`
    : sql`(r.version = ${ANALYTICS_ROLLUP_SYNCING} and r.built_at < now() - ${ANALYTICS_ROLLUP_ABANDONED_AFTER}::interval)`
  return sql`
    select d.day::text as day
    from (
      select distinct day from analytics_session ${inRange}
      union
      select distinct day from analytics_supplier_day_state ${inRange}
    ) d
    left join analytics_day_rollup r on r.day = d.day
    where r.day is null
       or ${syncingStale}
       or (r.version <> ${ANALYTICS_ROLLUP_SYNCING} and r.version <> ${sql.raw(analyticsDayVersionSql('d.day'))})
    order by 1`
}

/**
 * The selection model's reference of a closed day, per service, for the "What if your fleet changed?" card: the day's
 * latest session start of the service (`height`), the suppliers that session drew from (`candidates`, the
 * analytics_session value), the seats per draw (`cap`, the session param num_suppliers_per_session at that height),
 * and how many of the day's verified suppliers were among them (`own_eligible`: their service configs live at the
 * start and activated by it, counted by the indexer from our ids only). `version` is the day's analyticsDayVersionSql
 * the count was taken under: a row counts only while its day is closed and still has that version (a supplier added
 * to the day, or a key leaving the verified states, changes it and the sync counts the day again). A service whose
 * count came out above its candidates is not stored.
 */
export const analyticsSelectionReferenceTable = pgTable('analytics_selection_reference', {
  day: date('day', { mode: 'string' }).notNull(),
  serviceId: varchar('service_id', { length: 255 }).notNull(),
  height: bigint('height', { mode: 'number' }).notNull(),
  candidates: integer('candidates').notNull(),
  cap: integer('cap').notNull(),
  ownEligible: integer('own_eligible').notNull(),
  version: varchar('version', { length: 32 }).notNull(),
  fetchedAt: timestamp('fetched_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.serviceId] }),
])

/**
 * One row per day whose selection references were written, with the version they were counted under: the sync's
 * record that the day is done, also when it stored no reference row (no verified supplier left on the day, or every
 * service counted above its candidates), so such a day is not counted again until its version changes.
 */
export const analyticsSelectionReferenceDayTable = pgTable('analytics_selection_reference_day', {
  day: date('day', { mode: 'string' }).primaryKey(),
  version: varchar('version', { length: 32 }).notNull(),
  fetchedAt: timestamp('fetched_at').notNull(),
})

export type AnalyticsSelectionReference = typeof analyticsSelectionReferenceTable.$inferSelect
export type InsertAnalyticsSelectionReference = typeof analyticsSelectionReferenceTable.$inferInsert

export type AnalyticsSupplierDay = typeof analyticsSupplierDayTable.$inferSelect
export type InsertAnalyticsSupplierDay = typeof analyticsSupplierDayTable.$inferInsert
export type AnalyticsServiceDay = typeof analyticsServiceDayTable.$inferSelect
export type InsertAnalyticsServiceDay = typeof analyticsServiceDayTable.$inferInsert
export type AnalyticsSession = typeof analyticsSessionTable.$inferSelect
export type InsertAnalyticsSession = typeof analyticsSessionTable.$inferInsert
export type AnalyticsSessionMember = typeof analyticsSessionMemberTable.$inferSelect
export type InsertAnalyticsSessionMember = typeof analyticsSessionMemberTable.$inferInsert
export type AnalyticsSupplierDayState = typeof analyticsSupplierDayStateTable.$inferSelect
export type InsertAnalyticsSupplierDayState = typeof analyticsSupplierDayStateTable.$inferInsert
export type AnalyticsOwnerDay = typeof analyticsOwnerDayTable.$inferSelect
