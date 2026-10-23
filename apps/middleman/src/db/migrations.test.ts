/**
 * Applies the real middleman migration chain to a dedicated test database. Needs a Postgres server, so it
 * only runs when MIGRATION_TEST_DATABASE_URL points at a local database whose name contains "test"
 * (e.g. postgres://postgres:pw@127.0.0.1:55432/igniter_migrations_test);
 * `scripts/test-migrations.sh` starts one in Docker and runs this file. CI has no Postgres and skips it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const serverUrl = process.env.MIGRATION_TEST_DATABASE_URL
const migrationsFolder = path.resolve(__dirname, '../../drizzle')
const describeWithDb = serverUrl ? describe : describe.skip

// Safety rails: the test wipes schemas, so it only ever touches a LOCAL database whose name contains
// "test". It never creates or drops databases. Anything else fails and asks for a manual setup.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TEST_DATABASE = /test/i

function refuse(reason: string): never {
  throw new Error(
    `migrations.test refuses to run: ${reason}. Point MIGRATION_TEST_DATABASE_URL at a local database ` +
      `whose name contains "test" (scripts/test-migrations.sh creates igniter_migrations_test); ` +
      `create, empty or drop any other database by hand.`,
  )
}

if (serverUrl) {
  const url = new URL(serverUrl)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!LOCAL_HOSTS.has(url.hostname)) refuse(`host ${url.hostname} is not local`)
  if (!TEST_DATABASE.test(database)) refuse(`database "${database || '(none)'}" does not contain "test"`)
}

jest.setTimeout(60_000)

/**
 * Runs `fn` on the test database after resetting it to an empty schema. The reset drops only the
 * `public` schema (where every middleman migration writes) and drizzle's own `drizzle` schema, and
 * only after the SERVER confirms the connected database's name contains "test", not just the URL.
 */
async function withCleanTestDatabase<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: serverUrl })
  try {
    const { rows } = await pool.query<{ db: string }>('select current_database() as db')
    const connected = rows[0]?.db ?? ''
    if (!TEST_DATABASE.test(connected)) refuse(`connected database "${connected}" does not contain "test"`)
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
    await pool.query('CREATE SCHEMA public')
    return await fn(pool)
  } finally {
    await pool.end()
  }
}

/** A copy of the migrations folder whose journal stops at `lastTagPrefix`, to build an older schema. */
function migrationsUpTo(lastTagPrefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleman-migrations-'))
  fs.cpSync(migrationsFolder, dir, { recursive: true })
  const journalPath = path.join(dir, 'meta/_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  const last = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith(lastTagPrefix))
  journal.entries = journal.entries.slice(0, last + 1)
  fs.writeFileSync(journalPath, JSON.stringify(journal))
  return dir
}

const insertTransaction = (pool: Pool, signedPayload: string, unsignedPayload: string, status: string) =>
  pool.query(
    `insert into transactions (type, status, "signedPayload", "fromAddress", "unsignedPayload", "estimatedFee", "consumedFee", "createdBy")
     values ('Unstake', $3, $1, 'pokt1from', $2, 1, 0, 'pokt1owner') returning id`,
    [signedPayload, unsignedPayload, status],
  )

describeWithDb('middleman migrations', () => {
  it('a fresh database gets the non-empty payload constraints', async () => {
    await withCleanTestDatabase(async (pool) => {
      await migrate(drizzle(pool), { migrationsFolder })

      const { rows } = await pool.query(
        `select conname from pg_constraint where conname like 'transactions_%payload_not_empty' order by 1`,
      )
      expect(rows.map((r) => r.conname)).toEqual([
        'transactions_signed_payload_not_empty',
        'transactions_unsigned_payload_not_empty',
      ])
      // NOT VALID: existing rows are never rewritten or checked.
      const { rows: valid } = await pool.query(
        `select bool_or(convalidated) as any_validated from pg_constraint where conname like 'transactions_%payload_not_empty'`,
      )
      expect(valid[0]?.any_validated).toBe(false)
    })
  })

  it('two migrators applying 0020 at once both succeed (the middleman and workflows initContainers)', async () => {
    await withCleanTestDatabase(async (pool) => {
      const upTo0019 = migrationsUpTo('0019_')
      try {
        await migrate(drizzle(pool), { migrationsFolder: upTo0019 })
      } finally {
        fs.rmSync(upTo0019, { recursive: true, force: true })
      }
      await pool.query(`insert into users (identity, role) values ('pokt1owner', 'user')`)
      await insertTransaction(pool, '', '{"body":{}}', 'failure')

      // Force the race instead of hoping for it: a third session holds ROW EXCLUSIVE on the table,
      // which lets both migrators read "last = 0019" and open their transactions but parks each
      // one at its first stronger lock. Only once BOTH are parked is the blocker released. Without
      // the LOCK TABLE at the top of 0020 they would both pass the IF NOT EXISTS check and the
      // second ADD CONSTRAINT would fail with "already exists".
      const migratorA = new Pool({ connectionString: serverUrl })
      const migratorB = new Pool({ connectionString: serverUrl })
      const blocker = await pool.connect()
      try {
        await blocker.query('BEGIN')
        await blocker.query('LOCK TABLE "transactions" IN ROW EXCLUSIVE MODE')
        const running = Promise.allSettled([
          migrate(drizzle(migratorA), { migrationsFolder }),
          migrate(drizzle(migratorB), { migrationsFolder }),
        ])
        for (let i = 0; i < 100; i++) {
          const { rows: waiting } = await pool.query(
            `select count(*)::int as n from pg_locks where relation = '"transactions"'::regclass and not granted`,
          )
          if (waiting[0]?.n === 2) break
          await new Promise((r) => setTimeout(r, 50))
        }
        await blocker.query('COMMIT')
        const outcomes = await running
        // drizzle wraps the Postgres error as "Failed query: <sql>"; the reason is on `.cause`.
        const outcome = (o: PromiseSettledResult<unknown>) =>
          o.status === 'fulfilled' ? 'fulfilled' : String((o.reason as { cause?: Error })?.cause?.message ?? o.reason)
        expect(outcomes.map(outcome)).toEqual(['fulfilled', 'fulfilled'])
      } finally {
        blocker.release()
        await migratorA.end()
        await migratorB.end()
      }

      const { rows } = await pool.query(
        `select count(*)::int as n from pg_constraint where conname like 'transactions_%payload_not_empty'`,
      )
      expect(rows[0]?.n).toBe(2)
      // NOT VALID left the existing blank row alone.
      const { rows: tx } = await pool.query(`select "signedPayload" from transactions`)
      expect(tx).toEqual([{ signedPayload: '' }])
    })
  })

  it('0020 leaves existing rows and statuses alone, then refuses new blank payloads', async () => {
    await withCleanTestDatabase(async (pool) => {
      const upTo0019 = migrationsUpTo('0019_')
      try {
        await migrate(drizzle(pool), { migrationsFolder: upTo0019 })
      } finally {
        fs.rmSync(upTo0019, { recursive: true, force: true })
      }
      await pool.query(`insert into users (identity, role) values ('pokt1owner', 'user')`)
      await insertTransaction(pool, '', '{"body":{}}', 'pending') // like tx 519 before it was closed
      await insertTransaction(pool, '', '{"body":{}}', 'failure')
      await insertTransaction(pool, 'abcd', '{"body":{}}', 'pending')

      await migrate(drizzle(pool), { migrationsFolder })

      const { rows } = await pool.query(`select status, "signedPayload" from transactions order by id`)
      expect(rows).toEqual([
        { status: 'pending', signedPayload: '' },
        { status: 'failure', signedPayload: '' },
        { status: 'pending', signedPayload: 'abcd' },
      ])

      await expect(insertTransaction(pool, '', '{}', 'pending')).rejects.toMatchObject({
        constraint: 'transactions_signed_payload_not_empty',
      })
      await expect(insertTransaction(pool, 'abcd', '  ', 'pending')).rejects.toMatchObject({
        constraint: 'transactions_unsigned_payload_not_empty',
      })
    })
  })
})
