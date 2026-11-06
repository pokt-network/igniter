/**
 * The selection reference queries against a real Postgres with the real provider migration chain: which days get a
 * reference, and from which session. Needs a Postgres server: it only runs when MIGRATION_TEST_DATABASE_URL points at
 * a local database whose name contains "test" (it wipes the schema). CI has no Postgres and skips it.
 */
import path from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as schema from '@igniter/db/provider/schema'
import Analytics from '@/lib/dal/analytics'

const serverUrl = process.env.MIGRATION_TEST_DATABASE_URL
const migrationsFolder = path.resolve(__dirname, '../../../../provider/drizzle')
const describeWithDb = serverUrl ? describe : describe.skip

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TEST_DATABASE = /test/i

function refuse(reason: string): never {
  throw new Error(`analytics.reference.pg.test refuses to run: ${reason}. Point MIGRATION_TEST_DATABASE_URL at a local database whose name contains "test".`)
}

if (serverUrl) {
  const url = new URL(serverUrl)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!LOCAL_HOSTS.has(url.hostname)) refuse(`host ${url.hostname} is not local`)
  if (!TEST_DATABASE.test(database)) refuse(`database "${database || '(none)'}" does not contain "test"`)
}

jest.setTimeout(60_000)

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describeWithDb('Analytics DAL selection references on real Postgres', () => {
  let db: NodePgDatabase<typeof schema>
  let analytics: Analytics
  const run = async (query: SQL): Promise<Row[]> => (await db.execute(query)).rows as Row[]

  const session = (id: string, day: string, service: string, height: number, candidates: number | null) => run(sql`
    insert into analytics_session (session_id, day, service_id, application_id, start_height, phase, money_missing, roster_size, candidates, fetched_at)
    values (${id}, ${day}, ${service}, 'pokt1app', ${height}, 'settled', false, 50, ${candidates}, now())`)
  const state = (day: string, supplier: string, closed: boolean) => run(sql`
    insert into analytics_supplier_day_state (day, supplier_id, closed, fetched_at) values (${day}, ${supplier}, ${closed}, now())
    on conflict (day, supplier_id) do update set closed = excluded.closed`)
  const key = (address: string, state: string) => run(sql`
    insert into keys (address, "publicKey", "privateKey", state) values (${address}, ${`pk-${address}`}, 'sk', ${state})
    on conflict (address) do update set state = excluded.state`)
  const row = (day: string, version: string, ownEligible = 1) =>
    ({ day, serviceId: 'base', height: 1, candidates: 3352, cap: 50, ownEligible, version, fetchedAt: new Date() })

  beforeAll(async () => {
    db = drizzle({ connection: serverUrl!, schema }) as NodePgDatabase<typeof schema>
    const rows = await run(sql`select current_database() as db`)
    if (!TEST_DATABASE.test(rows[0]?.db ?? '')) refuse(`connected database "${rows[0]?.db}" does not contain "test"`)
    await run(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await run(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await run(sql`CREATE SCHEMA public`)
    await migrate(db, { migrationsFolder })
    analytics = new Analytics({ db } as never, logger as never)
  })

  afterAll(async () => {
    // drizzle({ connection }) owns a pg Pool here.
    await (db as unknown as { $client?: { end: () => Promise<void> } })?.$client?.end()
  })

  beforeEach(async () => {
    await run(sql`truncate analytics_session, analytics_supplier_day_state, analytics_selection_reference, analytics_selection_reference_day, keys cascade`)
    await key('pokt1a', 'staked')
    await key('pokt1b', 'unstaking')
  })

  it('takes closed days with a session that has candidates, newest first, leaving out `exclude`', async () => {
    await session('s1', '2026-10-03', 'base', 10, 3000)
    await session('s2', '2026-10-04', 'base', 20, 3000)
    await session('s3', '2026-10-05', 'base', 30, 3000)
    await session('s7', '2026-10-07', 'base', 70, null)
    for (const day of ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']) await state(day, 'pokt1a', true)
    // 02 and 06: no session. 07: no session with candidates. 04: one supplier still open.
    await state('2026-10-04', 'pokt1b', false)
    expect(await analytics.selectionReferenceDays()).toEqual(['2026-10-05', '2026-10-03'])
    expect(await analytics.selectionReferenceDays(['2026-10-05'])).toEqual(['2026-10-03'])
  })

  it('takes a day again when its version changes: a supplier added, or a key leaving the verified states', async () => {
    await session('s1', '2026-10-05', 'base', 30, 3000)
    await state('2026-10-05', 'pokt1a', true)
    const first = await analytics.selectionReferenceInputs('2026-10-05')
    expect(await analytics.replaceSelectionReferences('2026-10-05', first.version, [row('2026-10-05', first.version)])).toBe(true)
    expect(await analytics.selectionReferenceDays()).toEqual([])
    // The backfill fetched and closed one more supplier of that day.
    await state('2026-10-05', 'pokt1b', true)
    expect(await analytics.selectionReferenceDays()).toEqual(['2026-10-05'])
    const second = await analytics.selectionReferenceInputs('2026-10-05')
    expect(second.suppliers).toEqual(['pokt1a', 'pokt1b'])
    await analytics.replaceSelectionReferences('2026-10-05', second.version, [row('2026-10-05', second.version, 2)])
    expect(await analytics.selectionReferenceDays()).toEqual([])
    // A key leaves the verified states: the day is counted again, without it.
    await key('pokt1b', 'available')
    expect(await analytics.selectionReferenceDays()).toEqual(['2026-10-05'])
    expect((await analytics.selectionReferenceInputs('2026-10-05')).suppliers).toEqual(['pokt1a'])
  })

  it('a day written with no rows is done under its version, and pending again when the version changes', async () => {
    await session('s1', '2026-10-05', 'base', 30, 3000)
    await state('2026-10-05', 'pokt1a', true)
    const inputs = await analytics.selectionReferenceInputs('2026-10-05')
    // Every service over its candidates, or no verified supplier left: nothing to store, and the day is still done.
    expect(await analytics.replaceSelectionReferences('2026-10-05', inputs.version, [])).toBe(true)
    expect(await analytics.selectionReferenceDays()).toEqual([])
    expect(await run(sql`select count(*)::int as n from analytics_selection_reference`)).toEqual([{ n: 0 }])
    await key('pokt1a', 'available')
    expect(await analytics.selectionReferenceDays()).toEqual(['2026-10-05'])
    const none = await analytics.selectionReferenceInputs('2026-10-05')
    expect(none.suppliers).toEqual([])
    await analytics.replaceSelectionReferences('2026-10-05', none.version, [])
    expect(await analytics.selectionReferenceDays()).toEqual([])
  })

  it('writes nothing when the day changed after its inputs were read', async () => {
    await session('s1', '2026-10-05', 'base', 30, 3000)
    await state('2026-10-05', 'pokt1a', true)
    const inputs = await analytics.selectionReferenceInputs('2026-10-05')
    await state('2026-10-05', 'pokt1b', true)
    expect(await analytics.replaceSelectionReferences('2026-10-05', inputs.version, [row('2026-10-05', inputs.version)])).toBe(false)
    expect(await run(sql`select count(*)::int as n from analytics_selection_reference`)).toEqual([{ n: 0 }])
    expect(await run(sql`select count(*)::int as n from analytics_selection_reference_day`)).toEqual([{ n: 0 }])
  })

  it('reads each service\'s latest session start of the day with its candidates, and the day\'s verified suppliers', async () => {
    await session('a', '2026-10-05', 'base', 951481, 3350)
    await session('b', '2026-10-05', 'base', 952141, 3352)
    await session('c', '2026-10-05', 'base', 952141, 3352)
    await session('d', '2026-10-05', 'bsc', 952121, 4027)
    await session('e', '2026-10-05', 'eth', 952141, null)
    await session('f', '2026-10-04', 'base', 999999, 1)
    await key('pokt1c', 'imported')
    await state('2026-10-05', 'pokt1b', true)
    await state('2026-10-05', 'pokt1a', true)
    await state('2026-10-05', 'pokt1c', true)
    const inputs = await analytics.selectionReferenceInputs('2026-10-05')
    expect(inputs.version).toMatch(/^[0-9a-f]{32}$/)
    expect({ services: inputs.services, suppliers: inputs.suppliers }).toEqual({
      services: [
        { serviceId: 'base', height: 952141, candidates: 3352 },
        { serviceId: 'bsc', height: 952121, candidates: 4027 },
      ],
      suppliers: ['pokt1a', 'pokt1b'],
    })
  })

  it('replaces a day\'s rows and leaves other days alone', async () => {
    await state('2026-10-04', 'pokt1a', true)
    await state('2026-10-05', 'pokt1a', true)
    const v4 = (await analytics.selectionReferenceInputs('2026-10-04')).version
    const v5 = (await analytics.selectionReferenceInputs('2026-10-05')).version
    await analytics.replaceSelectionReferences('2026-10-04', v4, [row('2026-10-04', v4)])
    await analytics.replaceSelectionReferences('2026-10-05', v5, [row('2026-10-05', v5, 2342), { ...row('2026-10-05', v5, 2000), serviceId: 'bsc' }])
    await analytics.replaceSelectionReferences('2026-10-05', v5, [{ ...row('2026-10-05', v5, 2343), height: 2 }])
    const rows = await run(sql`select day::text, service_id, height::int, own_eligible from analytics_selection_reference order by 1, 2`)
    expect(rows).toEqual([
      { day: '2026-10-04', service_id: 'base', height: 1, own_eligible: 1 },
      { day: '2026-10-05', service_id: 'base', height: 2, own_eligible: 2343 },
    ])
  })
})
