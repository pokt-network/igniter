import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@igniter/db/provider/schema'
import Analytics from '@/lib/dal/analytics'

type Query = { text: string; values: unknown[] }

/** A node-postgres client stand-in: records every statement drizzle sends and answers with no rows. */
function fakeAnalytics() {
  const queries: Query[] = []
  const client = {
    query: jest.fn(async (q: string | { text: string }, values?: unknown[]) => {
      queries.push({ text: typeof q === 'string' ? q : q.text, values: values ?? [] })
      return { rows: [], rowCount: 0, fields: [] }
    }),
  }
  const db = drizzle(client as never, { schema })
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { analytics: new Analytics({ db } as never, logger as never), queries }
}

describe('Analytics DAL', () => {
  it('retention deletes from every analytics table only the days before the cutoff', async () => {
    const { analytics, queries } = fakeAnalytics()
    await analytics.deleteDaysBefore('2026-07-28')
    expect(queries.map((q) => q.text)).toEqual([
      'delete from "analytics_day_rollup" where "analytics_day_rollup"."day" < $1',
      'delete from "analytics_owner_day" where "analytics_owner_day"."day" < $1',
      'delete from "analytics_selection_reference_day" where "analytics_selection_reference_day"."day" < $1',
      'delete from "analytics_selection_reference" where "analytics_selection_reference"."day" < $1',
      'delete from "analytics_session_member" where "analytics_session_member"."day" < $1',
      'delete from "analytics_session" where "analytics_session"."day" < $1',
      'delete from "analytics_supplier_day" where "analytics_supplier_day"."day" < $1',
      'delete from "analytics_service_day" where "analytics_service_day"."day" < $1',
      'delete from "analytics_supplier_day_state" where "analytics_supplier_day_state"."day" < $1',
    ])
    expect(queries.every((q) => q.values[0] === '2026-07-28')).toBe(true)
  })

  it('rebuilds a day\'s rollups in one REPEATABLE READ transaction that reads the day\'s version first (snapshot)', async () => {
    const { analytics, queries } = fakeAnalytics()
    await analytics.rebuildDayRollup('2026-10-20', 'sync')
    expect(queries.map((q) => q.text.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'begin isolation level', 'select (select md5(coalesce(string_agg(st.supplier_id', 'delete from "analytics_owner_day"', 'insert into "analytics_owner_day"',
      'update "analytics_session" s', 'insert into "analytics_day_rollup"', 'commit',
    ])
    expect(queries[0]!.text).toBe('begin isolation level repeatable read')
    // The version is the day's own: a digest of that day's suppliers only.
    expect(queries[1]!.text).toContain('where st.day = d.day')
    expect(queries[1]!.values).toEqual(['2026-10-20'])
    expect(queries[3]!.text).toContain('count(distinct m.session_id)')
    expect(queries[3]!.text).toContain('k.state = any(')
    // Each session of the day gets its verified members' count, Y and B.
    expect(queries[4]!.text).toContain('own_members = t.x, own_paid_upokt = t.y, own_equal_share_upokt = t.b')
    // The rollup row is stamped with the version read first, not a later read.
    expect(queries[5]!.text).not.toContain('md5(')
    expect(queries[5]!.values[0]).toBe('2026-10-20')
  })

  it('the scheduled rebuild locks the day\'s mark first, and stamps only over a mark no sync holds', async () => {
    const { analytics, queries } = fakeAnalytics()
    await expect(analytics.rebuildDayRollup('2026-10-20', 'scheduled')).resolves.toEqual({ rows: 0, skipped: true })
    // The fake client answers no rows, so the conditional upsert stamps nothing: the transaction rolls back.
    expect(queries[0]!.text).toBe('begin isolation level repeatable read')
    expect(queries[1]!.text).toContain('for update')
    expect(queries[1]!.text).toContain('version = $1 as syncing')
    const stamp = queries.find((q) => q.text.trim().startsWith('insert into "analytics_day_rollup"'))!
    expect(stamp.text).toContain('where "analytics_day_rollup".version <> $')
    expect(queries.at(-1)!.text).toBe('rollback')
  })

  it('a batch end refreshes only a syncing mark', async () => {
    const { analytics, queries } = fakeAnalytics()
    await analytics.touchDaySyncing('2026-10-20')
    expect(queries[0]!.text).toContain('update "analytics_day_rollup" set built_at = now() where day = $1 and version = $2')
    expect(queries[0]!.values).toEqual(['2026-10-20', 'syncing'])
  })

  it('marks a day syncing (an upsert, never a delete)', async () => {
    const { analytics, queries } = fakeAnalytics()
    await analytics.markDaySyncing('2026-10-20')
    expect(queries[0]!.text).toContain('insert into "analytics_day_rollup" (day, version, built_at) values ($1, $2, now())')
    expect(queries[0]!.values).toEqual(['2026-10-20', 'syncing'])
  })

  it('a sync page upsert keeps the day rebuild\'s own_* columns', async () => {
    const { analytics, queries } = fakeAnalytics()
    await analytics.upsertSessionPage([{
      sessionId: 'a', day: '2026-10-20', serviceId: 'akash', applicationId: 'pokt1app', startHeight: 1, phase: 'settled',
      moneyMissing: false, paidUpokt: '5', rosterSize: 50, candidates: 4499, fetchedAt: new Date(),
    }], [])
    const upsert = queries.find((q) => q.text.startsWith('insert into "analytics_session"'))!
    expect(upsert.text).not.toContain('"own_members" = excluded')
    expect(upsert.text).toContain('"phase" = excluded."phase"')
  })

  it('uses the shared stale-day rule, for a rebuild', async () => {
    const { analytics, queries } = fakeAnalytics()
    expect(await analytics.staleRollupDays()).toEqual([])
    expect(queries[0]!.text).toContain('select distinct day from analytics_session')
    expect(queries[0]!.text).toContain("r.built_at < now() - $")
  })

  it('upserts a session page in session_id order, sessions before members, in one transaction', async () => {
    const { analytics, queries } = fakeAnalytics()
    const fetchedAt = new Date('2026-10-25T10:00:00Z')
    const session = (sessionId: string) => ({
      sessionId, day: '2026-10-20', serviceId: 'akash', applicationId: 'pokt1app', startHeight: 1, phase: 'settled',
      moneyMissing: false, paidUpokt: '5', rosterSize: 50, candidates: 4499, fetchedAt,
    })
    const member = (sessionId: string, supplierId: string) => ({
      sessionId, supplierId, day: '2026-10-20', state: 'paid', paidUpokt: '1', equalShareUpokt: '1', fetchedAt,
    })
    await analytics.upsertSessionPage(
      [session('c'), session('a'), session('b')],
      [member('c', 'pokt1x'), member('a', 'pokt1y'), member('a', 'pokt1x')],
    )
    expect(queries.map((q) => q.text.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin', 'insert into "analytics_session"', 'insert into "analytics_session_member"', 'commit',
    ])
    expect(queries[1]!.text).toContain('on conflict ("session_id") do update set')
    expect(queries[1]!.text).toContain('"paid_upokt" = excluded."paid_upokt"')
    // The first value of each row is its session_id: written in order.
    expect(queries[1]!.values.filter((v, i) => i % 11 === 0)).toEqual(['a', 'b', 'c'])
    expect(queries[2]!.values.filter((v, i) => i % 7 < 2)).toEqual(['a', 'pokt1x', 'a', 'pokt1y', 'c', 'pokt1x'])
  })

  it('replaces the batch\'s rows of the day: upsert, delete what the answer no longer has, network_sessions', async () => {
    const { analytics, queries } = fakeAnalytics()
    const fetchedAt = new Date('2026-10-25T10:00:00Z')
    await analytics.replaceSupplierDays(
      '2026-10-20',
      ['pokt1a', 'pokt1b'],
      [{ day: '2026-10-20', supplierId: 'pokt1a', serviceId: 'akash', seats: 1, fetchedAt }],
      [{ day: '2026-10-20', serviceId: 'akash', networkSessions: 142, fetchedAt }],
    )
    expect(queries.map((q) => q.text.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin', 'insert into "analytics_supplier_day"', 'delete from "analytics_supplier_day"', 'insert into "analytics_service_day"', 'commit',
    ])
    // Keeps exactly the (supplier, service) keys of the answer: no time cut.
    expect(queries[2]!.text.replace(/\s+/g, ' ')).toBe(
      'delete from "analytics_supplier_day" where ("analytics_supplier_day"."day" = $1 and "analytics_supplier_day"."supplier_id" in ($2, $3) and ("analytics_supplier_day"."supplier_id", "analytics_supplier_day"."service_id") not in ( select * from unnest($4::text[], $5::text[])))',
    )
    expect(queries[2]!.values).toEqual(['2026-10-20', 'pokt1a', 'pokt1b', ['pokt1a'], ['akash']])
    expect(queries[3]!.text).toContain('on conflict ("day","service_id") do update set "network_sessions" = excluded."network_sessions"')
  })

  it('reopens closed days from a day on, for every supplier', async () => {
    const { analytics, queries } = fakeAnalytics()
    await analytics.reopenClosedFrom('2026-10-23')
    expect(queries[0]!.text).toBe(
      'update "analytics_supplier_day_state" set "closed" = $1 where ("analytics_supplier_day_state"."closed" = $2 and "analytics_supplier_day_state"."day" >= $3)',
    )
    expect(queries[0]!.values).toEqual([false, true, '2026-10-23'])
  })
})
