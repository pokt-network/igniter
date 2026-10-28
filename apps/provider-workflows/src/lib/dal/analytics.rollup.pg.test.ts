/**
 * The day rebuild's rollups (analytics_owner_day and analytics_session.own_*) against a real Postgres with the real provider
 * migration chain: the stored values must equal what the member rows give when counted live. A mocked client cannot
 * prove SQL arithmetic. Needs a Postgres server: it only runs when MIGRATION_TEST_DATABASE_URL points at a local
 * database whose name contains "test" (it wipes the schema). CI has no Postgres and skips it.
 */
import path from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as schema from '@igniter/db/provider/schema'
import { analyticsStaleRollupDaysSql } from '@igniter/db/provider/schema'
import Analytics from '@/lib/dal/analytics'

const serverUrl = process.env.MIGRATION_TEST_DATABASE_URL
const migrationsFolder = path.resolve(__dirname, '../../../../provider/drizzle')
const describeWithDb = serverUrl ? describe : describe.skip

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TEST_DATABASE = /test/i

function refuse(reason: string): never {
  throw new Error(`analytics.rollup.pg.test refuses to run: ${reason}. Point MIGRATION_TEST_DATABASE_URL at a local database whose name contains "test".`)
}

if (serverUrl) {
  const url = new URL(serverUrl)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!LOCAL_HOSTS.has(url.hostname)) refuse(`host ${url.hostname} is not local`)
  if (!TEST_DATABASE.test(database)) refuse(`database "${database || '(none)'}" does not contain "test"`)
}

jest.setTimeout(60_000)

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const DAYS = ['2026-10-20', '2026-10-21']
// Three verified suppliers under two owners, and one key that is not verified (its member rows must not count).
const KEYS: Array<[address: string, state: string, owner: string | null]> = [
  ['pokt1a', 'staked', 'pokt1ownerx'],
  ['pokt1b', 'unstaking', 'pokt1ownerx'],
  ['pokt1c', 'staked', 'pokt1ownery'],
  ['pokt1z', 'imported', 'pokt1ownerz'],
]

/** The DAL with a hook right after the scheduled rebuild's lock, to race a sync against it. */
class RacingAnalytics extends Analytics {
  race: (() => Promise<void>) | null = null

  protected override async afterScheduledLock(): Promise<void> {
    await this.race?.()
  }
}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describeWithDb('Analytics DAL day rebuild on real Postgres', () => {
  let db: NodePgDatabase<typeof schema>
  let analytics: RacingAnalytics
  const run = async (query: SQL): Promise<Row[]> => (await db.execute(query)).rows as Row[]

  beforeAll(async () => {
    db = drizzle({ connection: serverUrl!, schema }) as NodePgDatabase<typeof schema>
    const rows = await run(sql`select current_database() as db`)
    if (!TEST_DATABASE.test(rows[0]?.db ?? '')) refuse(`connected database "${rows[0]?.db}" does not contain "test"`)
    await run(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await run(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await run(sql`CREATE SCHEMA public`)
    await migrate(db, { migrationsFolder })
    analytics = new RacingAnalytics({ db } as never, logger as never)

    for (const [address, state, owner] of KEYS) {
      await run(sql`insert into keys (address, "publicKey", "privateKey", state, "stakeOwner")
        values (${address}, ${`pk-${address}`}, 'sk', ${state}, ${owner})`)
    }
    // 2 days x 2 services x 5 sessions; members vary per session so counts, Y and B differ.
    let n = 0
    for (const day of DAYS) {
      for (const service of ['eth', 'bsc']) {
        for (let i = 0; i < 5; i++) {
          n++
          const id = `${day}-${service}-${i}`
          await run(sql`insert into analytics_session (session_id, day, service_id, application_id, start_height, phase, money_missing, paid_upokt, roster_size, candidates, fetched_at)
            values (${id}, ${day}, ${service}, ${`pokt1app${i % 2}`}, ${n}, 'settled', false, ${String(1000 + n)}, 50, 4000, now())`)
          const members = KEYS.filter((_, k) => (n + k) % 3 !== 0)
          for (const [k, [supplier]] of members.entries()) {
            await run(sql`insert into analytics_session_member (session_id, supplier_id, day, state, paid_upokt, equal_share_upokt, fetched_at)
              values (${id}, ${supplier}, ${day}, 'paid', ${String(n * 10 + k)}, ${String(n * 7 + k)}, now())`)
          }
        }
      }
    }
    // The sync writes a state row per (day, supplier) it fetched.
    for (const day of DAYS) {
      for (const [address] of KEYS) {
        await run(sql`insert into analytics_supplier_day_state (day, supplier_id, closed, fetched_at) values (${day}, ${address}, true, now())`)
      }
    }
    for (const day of DAYS) await analytics.rebuildDayRollup(day, 'sync')
  })

  afterAll(async () => {
    // drizzle({ connection }) owns a pg Pool here.
    await (db as unknown as { $client?: { end: () => Promise<void> } })?.$client?.end()
  })

  it('stores each session\'s verified members, Y and B as the member rows give them', async () => {
    const rows = await run(sql`
      select s.session_id, s.own_members as stored_x, s.own_paid_upokt::text as stored_y, s.own_equal_share_upokt::text as stored_b,
             live.x, live.y, live.b
      from analytics_session s
      left join (
        select m.session_id, count(*)::int as x, sum(m.paid_upokt)::text as y, sum(m.equal_share_upokt)::text as b
        from analytics_session_member m join keys k on k.address = m.supplier_id
        where k.state in ('staked', 'unstaking', 'unstaked', 'missing_stake', 'attention_needed', 'remediation_failed')
        group by 1) live on live.session_id = s.session_id
      order by 1`)
    expect(rows).toHaveLength(20)
    for (const r of rows) {
      expect(r.stored_x).toBe(r.x ?? 0)
      expect(r.stored_y).toBe(r.y)
      expect(r.stored_b).toBe(r.b)
    }
    // The unverified key's members are in the data, and left out.
    const z = await run(sql`select count(*)::int as n from analytics_session_member where supplier_id = 'pokt1z'`)
    expect(z[0]!.n).toBeGreaterThan(0)
  })

  it('stores the distinct sessions per (day, service, owner) as the member rows give them', async () => {
    const stored = await run(sql`
      select day::text, service_id, owner_address, sessions from analytics_owner_day order by 1, 2, 3`)
    const live = await run(sql`
      select m.day::text, s.service_id, k."stakeOwner" as owner_address, count(distinct m.session_id)::int as sessions
      from analytics_session_member m join analytics_session s using (session_id) join keys k on k.address = m.supplier_id
      where k.state in ('staked', 'unstaking', 'unstaked', 'missing_stake', 'attention_needed', 'remediation_failed')
      group by 1, 2, 3 order by 1, 2, 3`)
    expect(stored).toEqual(live)
    expect(stored.map((r) => r.owner_address)).not.toContain('pokt1ownerz')
  })

  it('key change: marks a day stale when one of its suppliers changes owner, and fresh again once rebuilt', async () => {
    expect(await analytics.staleRollupDays()).toEqual([])
    await run(sql`update keys set "stakeOwner" = 'pokt1ownerw' where address = 'pokt1c'`)
    expect(await analytics.staleRollupDays()).toEqual(DAYS)
    for (const day of DAYS) await analytics.rebuildDayRollup(day, 'sync')
    expect(await analytics.staleRollupDays()).toEqual([])
  })

  it('key change: a new key with no history there leaves every day fresh', async () => {
    await run(sql`insert into keys (address, "publicKey", "privateKey", state, "stakeOwner") values ('pokt1new', 'pk-new', 'sk', 'staked', 'pokt1ownerx')`)
    expect(await analytics.staleRollupDays()).toEqual([])
  })

  it('key change: a key leaving the verified states marks the days it has stored rows on stale', async () => {
    await run(sql`update keys set state = 'imported' where address = 'pokt1b'`)
    expect(await analytics.staleRollupDays()).toEqual(DAYS)
    for (const day of DAYS) await analytics.rebuildDayRollup(day, 'sync')
    expect(await analytics.staleRollupDays()).toEqual([])
    await run(sql`update keys set state = 'unstaking' where address = 'pokt1b'`)
    for (const day of DAYS) await analytics.rebuildDayRollup(day, 'sync')
  })

  const readStale = async () => (await run(analyticsStaleRollupDaysSql({ from: '2026-10-01', to: '2026-10-31' }, 'read'))).map((r) => r.day)

  it('race: a day a sync is writing is stale to readers and left alone by the rebuild; a failed sync stays stale', async () => {
    // AnalyticsSyncDay marks the day syncing; a batch writes a new session (own_* null) and its rebuild never runs.
    await analytics.markDaySyncing(DAYS[0]!)
    await analytics.upsertSessionPage([{
      sessionId: 'late-session', day: DAYS[0]!, serviceId: 'eth', applicationId: 'pokt1app0', startHeight: 999,
      phase: 'settled', moneyMissing: false, paidUpokt: '5', rosterSize: 50, candidates: 4000, fetchedAt: new Date(),
    }], [{ sessionId: 'late-session', supplierId: 'pokt1a', day: DAYS[0]!, state: 'paid', paidUpokt: '3', equalShareUpokt: '2', fetchedAt: new Date() }])
    expect(await readStale()).toEqual([DAYS[0]])
    expect(await analytics.staleRollupDays()).toEqual([])
  })

  it('batch refresh: a finished batch moves a syncing mark forward, and leaves a built day alone', async () => {
    await run(sql`update analytics_day_rollup set built_at = now() - interval '90 minutes' where day = ${DAYS[0]!}`)
    await analytics.touchDaySyncing(DAYS[0]!)
    const fresh = await run(sql`select built_at > now() - interval '1 minute' as fresh from analytics_day_rollup where day = ${DAYS[0]!}`)
    expect(fresh[0]!.fresh).toBe(true)
    const before = await run(sql`select version, built_at::text as at from analytics_day_rollup where day = ${DAYS[1]!}`)
    await analytics.touchDaySyncing(DAYS[1]!)
    expect(await run(sql`select version, built_at::text as at from analytics_day_rollup where day = ${DAYS[1]!}`)).toEqual(before)
  })

  it('race window: a day marked syncing after the stale list is skipped by the scheduled rebuild, never stamped over', async () => {
    // Abandoned, so the scheduled rebuild lists it...
    await run(sql`update analytics_day_rollup set built_at = now() - interval '3 hours' where day = ${DAYS[0]!}`)
    expect(await analytics.staleRollupDays()).toEqual([DAYS[0]])
    // ...then a sync takes it before the rebuild runs.
    await analytics.markDaySyncing(DAYS[0]!)
    const own = await run(sql`select own_members from analytics_session where session_id = 'late-session'`)
    expect(await analytics.rebuildDayRollup(DAYS[0]!, 'scheduled')).toEqual({ rows: 0, skipped: true })
    expect((await run(sql`select version from analytics_day_rollup where day = ${DAYS[0]!}`))[0]!.version).toBe('syncing')
    expect(await run(sql`select own_members from analytics_session where session_id = 'late-session'`)).toEqual(own)
  })

  it('concurrent mark: a sync marking the day during a scheduled rebuild waits for its commit, then the day is syncing', async () => {
    const other = drizzle({ connection: serverUrl!, schema }) as NodePgDatabase<typeof schema>
    const otherAnalytics = new Analytics({ db: other } as never, logger as never)
    try {
      await run(sql`update analytics_day_rollup set built_at = now() - interval '3 hours' where day = ${DAYS[0]!}`)
      let marked = false
      let marking: Promise<void> = Promise.resolve()
      analytics.race = async () => {
        marking = otherAnalytics.markDaySyncing(DAYS[0]!).then(() => { marked = true })
        await new Promise((r) => setTimeout(r, 300))
        // The mark waits on the row this rebuild locked.
        expect(marked).toBe(false)
      }
      const result = await analytics.rebuildDayRollup(DAYS[0]!, 'scheduled')
      expect(result.skipped).toBe(false)
      await marking
      expect((await run(sql`select version from analytics_day_rollup where day = ${DAYS[0]!}`))[0]!.version).toBe('syncing')
    } finally {
      analytics.race = null
      await (other as unknown as { $client?: { end: () => Promise<void> } }).$client?.end()
    }
  })

  it('no row plus a concurrent mark: the scheduled rebuild fails to serialize, skips, and the day stays syncing', async () => {
    const day = '2026-10-24'
    await run(sql`insert into analytics_supplier_day_state (day, supplier_id, closed, fetched_at) values (${day}, 'pokt1a', true, now())`)
    const other = drizzle({ connection: serverUrl!, schema }) as NodePgDatabase<typeof schema>
    const otherAnalytics = new Analytics({ db: other } as never, logger as never)
    try {
      analytics.race = async () => {
        // No row to lock: the sync's insert commits at once, after this transaction's snapshot.
        await otherAnalytics.markDaySyncing(day)
      }
      const result = await analytics.rebuildDayRollup(day, 'scheduled')
      expect(result).toEqual({ rows: 0, skipped: true })
      expect((await run(sql`select version from analytics_day_rollup where day = ${day}`))[0]!.version).toBe('syncing')
    } finally {
      analytics.race = null
      await (other as unknown as { $client?: { end: () => Promise<void> } }).$client?.end()
    }
  })

  it('abandoned sync: a syncing mark older than 2 hours is rebuilt by the scheduled rebuild, and then fresh', async () => {
    await run(sql`update analytics_day_rollup set version = 'syncing', built_at = now() - interval '3 hours' where day = ${DAYS[0]!}`)
    expect(await analytics.staleRollupDays()).toContain(DAYS[0])
    expect((await analytics.rebuildDayRollup(DAYS[0]!, 'scheduled')).skipped).toBe(false)
    expect(await analytics.staleRollupDays()).not.toContain(DAYS[0])
    expect(await readStale()).not.toContain(DAYS[0])
    const late = await run(sql`select own_members, own_paid_upokt::text as y from analytics_session where session_id = 'late-session'`)
    expect(late[0]).toEqual({ own_members: 1, y: '3' })
  })

  it('snapshot: the rebuild stamps the version its rows were counted under', async () => {
    const stamped = await run(sql`select version from analytics_day_rollup where day = ${DAYS[0]!}`)
    const now = await run(sql`select ${sql.raw(schema.analyticsDayVersionSql(`'${DAYS[0]}'::date`))} as version`)
    expect(stamped[0]!.version).toBe(now[0]!.version)
    expect(stamped[0]!.version).toMatch(/^[0-9a-f]{32}$/)
  })

  it('no-state day: a day with sessions but no state rows and no rollup row is stale to both', async () => {
    const day = '2026-10-23'
    await run(sql`insert into analytics_session (session_id, day, service_id, application_id, start_height, phase, money_missing, paid_upokt, roster_size, candidates, fetched_at)
      values ('no-state', ${day}, 'eth', 'pokt1app0', 6000, 'settled', false, '10', 50, 4000, now())`)
    await run(sql`insert into analytics_session_member (session_id, supplier_id, day, state, paid_upokt, equal_share_upokt, fetched_at)
      values ('no-state', 'pokt1a', ${day}, 'paid', '4', '2', now())`)
    expect(await readStale()).toContain(day)
    expect(await analytics.staleRollupDays()).toContain(day)
    await analytics.rebuildDayRollup(day, 'scheduled')
    expect(await readStale()).not.toContain(day)
  })

  it('records a day with no verified member as rebuilt, so it is not rebuilt again', async () => {
    const day = '2026-10-22'
    await run(sql`insert into analytics_supplier_day_state (day, supplier_id, closed, fetched_at) values (${day}, 'pokt1z', true, now())`)
    await run(sql`insert into analytics_session (session_id, day, service_id, application_id, start_height, phase, money_missing, paid_upokt, roster_size, candidates, fetched_at)
      values ('z-only', ${day}, 'eth', 'pokt1app0', 5000, 'settled', false, '10', 50, 4000, now())`)
    await run(sql`insert into analytics_session_member (session_id, supplier_id, day, state, paid_upokt, equal_share_upokt, fetched_at)
      values ('z-only', 'pokt1z', ${day}, 'paid', '1', '1', now())`)
    expect(await analytics.staleRollupDays()).toEqual([day])
    expect(await analytics.rebuildDayRollup(day, 'scheduled')).toEqual({ rows: 0, skipped: false })
    expect(await analytics.staleRollupDays()).toEqual([])
  })

  it('the sync\'s own rebuild replaces its syncing mark', async () => {
    await analytics.markDaySyncing(DAYS[1]!)
    expect((await analytics.rebuildDayRollup(DAYS[1]!, 'sync')).skipped).toBe(false)
    expect((await run(sql`select version from analytics_day_rollup where day = ${DAYS[1]!}`))[0]!.version).toMatch(/^[0-9a-f]{32}$/)
  })

  it('a sync page upsert keeps the stored own_* values', async () => {
    const before = await run(sql`select own_members from analytics_session where session_id = '2026-10-20-eth-0'`)
    await analytics.upsertSessionPage([{
      sessionId: '2026-10-20-eth-0', day: '2026-10-20', serviceId: 'eth', applicationId: 'pokt1app0', startHeight: 1,
      phase: 'settled', moneyMissing: false, paidUpokt: '1001', rosterSize: 50, candidates: 4000, fetchedAt: new Date(),
    }], [])
    const after = await run(sql`select own_members from analytics_session where session_id = '2026-10-20-eth-0'`)
    expect(after[0]!.own_members).toBe(before[0]!.own_members)
    expect(after[0]!.own_members).not.toBeNull()
  })
})
