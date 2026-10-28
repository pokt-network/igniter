/**
 * Two attempts of syncAnalyticsSessionsDay racing on one (day, batch) against a real Postgres with the real migrations:
 * the interleaving that lost member rows in the e2e. Attempt 1 fetched the newest page and its write was held (a
 * pool wait under load) past the heartbeat timeout; attempt 2 ran the whole day; attempt 1's late write then landed
 * before attempt 2's stale-row delete. Every member of the answer must still be stored. Runs only with
 * MIGRATION_TEST_DATABASE_URL (a local database whose name contains "test"); CI has no Postgres and skips it.
 */
const heartbeat = jest.fn()
const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
jest.mock('@temporalio/activity', () => ({
  heartbeat: (d: unknown) => heartbeat(d),
  log,
  // Never cancelled: the race below is between two attempts that both still run (the server learns of a timeout
  // only at a heartbeat, so a write already waiting for a connection goes on regardless).
  Context: { current: () => ({ cancellationSignal: new AbortController().signal }) },
  ApplicationFailure: { nonRetryable: (msg: string) => new Error(msg) },
}))

const fetchSupplierSessionPage = jest.fn()
jest.mock('@igniter/graphql/analytics', () => ({
  ...jest.requireActual('@igniter/graphql/analytics'),
  // Two rows a page: three pages for the day.
  ANALYTICS_SESSION_PAGE_SIZE: 2,
  fetchSupplierSessionPage: (...a: unknown[]) => fetchSupplierSessionPage(...a),
}))

import path from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as schema from '@igniter/db/provider/schema'
import type { AnalyticsSessionRow } from '@igniter/graphql/analytics'
import Analytics from '@/lib/dal/analytics'
import { analyticsActivities } from '@/activities/analytics'

const serverUrl = process.env.MIGRATION_TEST_DATABASE_URL
const migrationsFolder = path.resolve(__dirname, '../../../provider/drizzle')
const describeWithDb = serverUrl ? describe : describe.skip
const TEST_DATABASE = /test/i
if (serverUrl) {
  const url = new URL(serverUrl)
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error(`refusing non-local host ${url.hostname}`)
  if (!TEST_DATABASE.test(decodeURIComponent(url.pathname))) throw new Error('refusing a database whose name lacks "test"')
}

jest.setTimeout(60_000)

const DAY = '2026-10-20'
const SUPPLIERS = ['pokt1a', 'pokt1b']

function row(sessionId: string, startHeight: string): AnalyticsSessionRow {
  return {
    sessionId, applicationId: 'pokt1app', serviceId: 'eth', startHeight, endHeight: null, startTime: `${DAY}T10:00:00+00:00`,
    phase: 'settled', settlementHeight: null, settledHeight: null, moneyMissing: false, rosterSize: '50', candidates: '4000',
    claimed: null, paidUpokt: '100', settledUpokt: null, relays: null, computeUnits: null,
    selectedSupplierIds: SUPPLIERS, selectedStates: ['paid', 'paid'], selectedPaidUpokt: ['3', '4'], selectedEqualShareUpokt: ['2', '2'],
  }
}

// Newest first, as the indexer pages: page 1 holds the highest heights.
const PAGES = [[row('s6', '600'), row('s5', '500')], [row('s4', '400'), row('s3', '300')], [row('s2', '200')]]
const answer = async (_url: string, p: { before?: { height: string } }) => {
  const i = p.before === undefined ? 0 : PAGES.findIndex((page) => page[0]!.startHeight < p.before!.height)
  return { range: {}, rows: PAGES[i]! }
}

type Gate = { wait: Promise<void>; open: () => void }
const gate = (): Gate => {
  let open = () => {}
  const wait = new Promise<void>((r) => { open = r })
  return { wait, open }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/** The DAL of one attempt, with optional holds before its first page write and before its stale-row delete. */
class HeldAnalytics extends Analytics {
  holdFirstWrite: Gate | null = null
  firstWriteStarted = gate()
  holdDelete: Gate | null = null
  deleteReached = gate()
  private writes = 0

  override async upsertSessionPage(...a: Parameters<Analytics['upsertSessionPage']>) {
    if (this.writes++ === 0 && this.holdFirstWrite) {
      this.firstWriteStarted.open()
      await this.holdFirstWrite.wait
    }
    return super.upsertSessionPage(...a)
  }

  override async deleteStaleSessionRows(...a: Parameters<Analytics['deleteStaleSessionRows']>) {
    this.deleteReached.open()
    if (this.holdDelete) await this.holdDelete.wait
    return super.deleteStaleSessionRows(...a)
  }
}

describeWithDb('syncAnalyticsSessionsDay: a late write of an abandoned attempt on real Postgres', () => {
  let db: NodePgDatabase<typeof schema>
  const run = async (q: SQL) => (await db.execute(q)).rows as Array<Record<string, unknown>>
  const activities = (analytics: Analytics) =>
    analyticsActivities({ analytics, settings: { loadSettings: async () => ({ indexerApiUrl: 'http://indexer.test' }) } } as never)

  beforeAll(async () => {
    db = drizzle({ connection: serverUrl!, schema }) as NodePgDatabase<typeof schema>
    const rows = await run(sql`select current_database() as db`)
    if (!TEST_DATABASE.test(String(rows[0]?.db))) throw new Error('refusing a database whose name lacks "test"')
    await run(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await run(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await run(sql`CREATE SCHEMA public`)
    await migrate(db, { migrationsFolder })
    fetchSupplierSessionPage.mockImplementation(answer)
  })

  afterAll(async () => {
    await (db as unknown as { $client?: { end: () => Promise<void> } })?.$client?.end()
  })

  it('keeps every member of the answer when attempt 1\'s held page-1 write lands before attempt 2\'s delete', async () => {
    const attempt1 = new HeldAnalytics({ db } as never, log as never)
    attempt1.holdFirstWrite = gate()
    const attempt2 = new HeldAnalytics({ db } as never, log as never)
    attempt2.holdDelete = gate()
    const params = { day: DAY, supplierIds: SUPPLIERS }

    // Attempt 1 fetches page 1 and its write waits (a pool connection under load).
    const first = activities(attempt1).syncAnalyticsSessionsDay(params).catch(() => undefined)
    await attempt1.firstWriteStarted.wait
    await tick()
    // The server timed attempt 1 out; attempt 2 runs the whole day up to its stale-row delete.
    const second = activities(attempt2).syncAnalyticsSessionsDay(params)
    await attempt2.deleteReached.wait
    // Attempt 1's page-1 write now lands; then attempt 2 deletes what it thinks is stale.
    attempt1.holdFirstWrite.open()
    await tick(200)
    attempt2.holdDelete.open()
    await second
    await first

    const stored = await run(sql`select session_id, supplier_id from analytics_session_member where day = ${DAY} order by 1, 2`)
    expect(stored).toHaveLength(PAGES.flat().length * SUPPLIERS.length)
    const sessions = await run(sql`select session_id from analytics_session where day = ${DAY} order by 1`)
    expect(sessions.map((r) => r.session_id)).toEqual(['s2', 's3', 's4', 's5', 's6'])
  })

  it('deletes the members the answer no longer has, and the sessions left with none, and nothing else', async () => {
    const analytics = new Analytics({ db } as never, log as never)
    const params = { day: DAY, supplierIds: SUPPLIERS }
    await activities(analytics).syncAnalyticsSessionsDay(params)
    // Another batch's member on the same day: outside `supplierIds`, never touched.
    await run(sql`insert into analytics_session_member (session_id, supplier_id, day, state, fetched_at)
                  values ('s4', 'pokt1other', ${DAY}, 'paid', now() - interval '1 day')`)

    // A reindex: s6 lost pokt1b, s2 is gone.
    const reindexed = [[{ ...row('s6', '600'), selectedSupplierIds: ['pokt1a'], selectedStates: ['paid'], selectedPaidUpokt: ['3'], selectedEqualShareUpokt: ['2'] }, row('s5', '500')], [row('s4', '400'), row('s3', '300')], []]
    fetchSupplierSessionPage.mockImplementation(async (_url: string, p: { before?: { height: string } }) => {
      const i = p.before === undefined ? 0 : reindexed.findIndex((page) => page.length === 0 || page[0]!.startHeight < p.before!.height)
      return { range: {}, rows: reindexed[i]! }
    })
    await activities(analytics).syncAnalyticsSessionsDay(params)
    fetchSupplierSessionPage.mockImplementation(answer)

    const stored = await run(sql`select session_id || '/' || supplier_id as k from analytics_session_member where day = ${DAY} order by 1`)
    expect(stored.map((r) => r.k)).toEqual([
      's3/pokt1a', 's3/pokt1b', 's4/pokt1a', 's4/pokt1b', 's4/pokt1other', 's5/pokt1a', 's5/pokt1b', 's6/pokt1a',
    ])
    const sessions = await run(sql`select session_id from analytics_session where day = ${DAY} order by 1`)
    expect(sessions.map((r) => r.session_id)).toEqual(['s3', 's4', 's5', 's6'])
  })

  it('closeInputs counts, per supplier of the batch, member rows, unsettled sessions and funnel seats (a null active counts as 0)', async () => {
    // Stored now: s3..s6 with pokt1a, s3..s5 with pokt1b, s4 with pokt1other (another batch).
    await run(sql`update analytics_session set phase = 'claimed' where session_id = 's5'`)
    await run(sql`update analytics_session set money_missing = true where session_id = 's6'`)
    await run(sql`insert into analytics_supplier_day (day, supplier_id, service_id, seats, active, fetched_at) values
      (${DAY}, 'pokt1a', 'eth', 2, 1, now()), (${DAY}, 'pokt1a', 'base', 1, null, now()), (${DAY}, 'pokt1b', 'eth', 3, null, now()),
      (${DAY}, 'pokt1other', 'eth', 9, 0, now())`)

    const inputs = await new Analytics({ db } as never, log as never).closeInputs(DAY, SUPPLIERS)
    expect(Object.fromEntries(inputs.memberRows)).toEqual({ pokt1a: 4, pokt1b: 3 })
    expect(Object.fromEntries(inputs.unsettledSessions)).toEqual({ pokt1a: 2, pokt1b: 1 })
    expect(Object.fromEntries(inputs.funnelSeats)).toEqual({ pokt1a: 4, pokt1b: 3 })
    expect(Object.fromEntries(inputs.activeSeats)).toEqual({ pokt1a: 1, pokt1b: 0 })
  })
})
