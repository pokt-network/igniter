/**
 * The dispatcher's queue query (listDispatchable) against a real Postgres with the real middleman
 * migration chain. Ordering and LIMIT live in SQL, so a mocked client cannot prove them. Needs a
 * Postgres server: it only runs when MIGRATION_TEST_DATABASE_URL points at a local database whose
 * name contains "test"; `scripts/test-migrations.sh` starts one in Docker and runs this file. CI has
 * no Postgres and skips it.
 */
import path from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '@igniter/db/middleman/schema'
import { transactionsTable, usersTable } from '@igniter/db/middleman/schema'
import { TransactionStatus, TransactionType, UserRole } from '@igniter/db/middleman/enums'
import Transaction from '@/lib/dal/transaction'

const serverUrl = process.env.MIGRATION_TEST_DATABASE_URL
const migrationsFolder = path.resolve(__dirname, '../../../../middleman/drizzle')
const describeWithDb = serverUrl ? describe : describe.skip

// Same safety rails as apps/middleman/src/db/migrations.test.ts: the test wipes schemas, so it only
// touches a LOCAL database whose name contains "test", checked on the URL and on the server.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TEST_DATABASE = /test/i

function refuse(reason: string): never {
  throw new Error(
    `transaction.dispatch.pg.test refuses to run: ${reason}. Point MIGRATION_TEST_DATABASE_URL at a ` +
      `local database whose name contains "test" (scripts/test-migrations.sh creates one).`,
  )
}

if (serverUrl) {
  const url = new URL(serverUrl)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!LOCAL_HOSTS.has(url.hostname)) refuse(`host ${url.hostname} is not local`)
  if (!TEST_DATABASE.test(database)) refuse(`database "${database || '(none)'}" does not contain "test"`)
}

jest.setTimeout(60_000)

const LIMIT = 100
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as ConstructorParameters<typeof Transaction>[1]

describeWithDb('Transaction DAL — listDispatchable on real Postgres', () => {
  let pool: Pool
  let db: ReturnType<typeof drizzle<typeof schema>>
  let dal: Transaction

  beforeAll(async () => {
    pool = new Pool({ connectionString: serverUrl })
    const { rows } = await pool.query<{ db: string }>('select current_database() as db')
    if (!TEST_DATABASE.test(rows[0]?.db ?? '')) refuse(`connected database "${rows[0]?.db}" does not contain "test"`)
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
    await pool.query('CREATE SCHEMA public')
    db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder })
    await db.insert(usersTable).values({ identity: 'pokt1dispatchtest', role: UserRole.Owner })
    dal = new Transaction({ db } as unknown as ConstructorParameters<typeof Transaction>[0], logger)
  })

  afterAll(async () => {
    await pool?.end()
  })

  beforeEach(async () => {
    await db.delete(transactionsTable)
  })

  /** Inserts `count` pending, unanchored rows; returns their ids in insert (id) order. */
  async function insertPending(count: number, dispatchAttempts = 0): Promise<number[]> {
    const rows = await db
      .insert(transactionsTable)
      .values(Array.from({ length: count }, () => ({
        type: TransactionType.Stake,
        status: TransactionStatus.Pending,
        signedPayload: '0a',
        unsignedPayload: '0a',
        fromAddress: 'pokt1from',
        estimatedFee: 1,
        consumedFee: 0,
        createdBy: 'pokt1dispatchtest',
        dispatchAttempts,
      })))
      .returning({ id: transactionsTable.id })
    return rows.map((r) => r.id)
  }

  it('a new row is listed even when LIMIT older rows are already in flight', async () => {
    // 100 older rows whose children are running or failing (an attempt already counted), then 5
    // new rows. Ordered by id alone, the new rows would wait behind the stuck ones until the
    // give-up removed them, an hour or more.
    const stuck = await insertPending(LIMIT, 1)
    const fresh = await insertPending(5)

    const listed = (await dal.listDispatchable(LIMIT)).map((r) => r.id)

    expect(listed).toHaveLength(LIMIT)
    expect(listed.slice(0, 5)).toEqual(fresh)
    expect(listed.slice(5)).toEqual(stuck.slice(0, LIMIT - 5))
  })

  it('a backlog larger than LIMIT drains across ticks, every row listed exactly once', async () => {
    const all = await insertPending(250)
    const seen: number[] = []

    for (let tick = 0; tick < 10; tick++) {
      const listed = (await dal.listDispatchable(LIMIT)).map((r) => r.id)
      if (listed.length === 0) break
      expect(listed.length).toBeLessThanOrEqual(LIMIT)
      seen.push(...listed)
      // Each listed row's child broadcasts: the anchor removes it from the queue.
      await db.update(transactionsTable).set({ hash: 'ABCD' }).where(inArray(transactionsTable.id, listed))
    }

    expect(seen).toHaveLength(all.length)
    expect(new Set(seen)).toEqual(new Set(all))
  })

  it('rows that keep failing are still reached and can be given up once fresher rows are gone', async () => {
    const failing = await insertPending(LIMIT + 20, 5)
    const fresh = await insertPending(10)

    const first = (await dal.listDispatchable(LIMIT)).map((r) => r.id)
    expect(first.slice(0, 10)).toEqual(fresh)
    await db.update(transactionsTable).set({ hash: 'ABCD' }).where(inArray(transactionsTable.id, fresh))

    // Give up on whatever is listed (the CAS the dispatcher uses), tick after tick.
    for (let tick = 0; tick < 5; tick++) {
      const listed = await dal.listDispatchable(LIMIT)
      for (const row of listed) await dal.claimUnbroadcastFailure(row.id, 'gave up')
    }

    const left = await db.select({ id: transactionsTable.id }).from(transactionsTable)
      .where(eq(transactionsTable.status, TransactionStatus.Pending))
    expect(left.filter((r) => failing.includes(r.id))).toHaveLength(0)
  })
})
