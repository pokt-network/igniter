/**
 * The failure-effects outbox (migration 0022) against a real Postgres with the real middleman
 * migration chain: every *WithEffects CAS, every transition of the release entry table, the notify
 * fence and the CHECK constraints. Each one is a single guarded UPDATE, so only a real database can
 * prove the guard. Needs a Postgres server: it only runs when MIGRATION_TEST_DATABASE_URL points at
 * a local database whose name contains "test"; `scripts/test-migrations.sh` starts one in Docker and
 * runs this file. CI has no Postgres and skips it.
 */
import path from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '@igniter/db/middleman/schema'
import { FailureEffectsState, transactionsTable, usersTable } from '@igniter/db/middleman/schema'
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
    `transaction.failureEffects.pg.test refuses to run: ${reason}. Point MIGRATION_TEST_DATABASE_URL at a ` +
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

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as ConstructorParameters<typeof Transaction>[1]

const STATES: Array<FailureEffectsState | null> = [null, 'pending', 'releasing', 'done', 'manual']

describeWithDb('Transaction DAL — failure-effects outbox on real Postgres', () => {
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
    await db.insert(usersTable).values({ identity: 'pokt1effectstest', role: UserRole.Owner })
    dal = new Transaction({ db } as unknown as ConstructorParameters<typeof Transaction>[0], logger)
  })

  afterAll(async () => {
    await pool?.end()
  })

  beforeEach(async () => {
    await db.delete(transactionsTable)
  })

  /** Inserts one Stake row; `hash` anchors it, `failureEffects` presets the outbox state. */
  async function insertRow(opts: {
    status?: TransactionStatus
    hash?: string | null
    failureEffects?: FailureEffectsState | null
  } = {}): Promise<number> {
    const [row] = await db
      .insert(transactionsTable)
      .values({
        type: TransactionType.Stake,
        status: opts.status ?? TransactionStatus.Pending,
        hash: opts.hash ?? null,
        failureEffects: opts.failureEffects ?? null,
        signedPayload: '0a',
        unsignedPayload: '0a',
        fromAddress: 'pokt1from',
        estimatedFee: 1,
        consumedFee: 0,
        createdBy: 'pokt1effectstest',
      })
      .returning({ id: transactionsTable.id })
    return row!.id
  }

  /** The outbox columns as stored, read with raw SQL so jsonb comes back exactly as Postgres has it. */
  async function outbox(id: number) {
    const { rows } = await pool.query(
      `select status, "failureEffects", "failureReleaseAddresses"::text as addresses,
              jsonb_typeof("failureReleaseAddresses") as addresses_type, "failureNotifiedAt"
       from transactions where id = $1`,
      [id],
    )
    return rows[0]
  }

  describe('the *WithEffects CAS writes the outbox in the same UPDATE', () => {
    it('claimUnbroadcastFailureWithEffects fails an unanchored row and owes the release of every supplier', async () => {
      const id = await insertRow()

      const row = await dal.claimUnbroadcastFailureWithEffects(id, 'gave up')

      expect(row).toMatchObject({ id, status: TransactionStatus.Failure, log: 'gave up', failureEffects: 'pending' })
      expect(await outbox(id)).toEqual({
        status: 'failure', failureEffects: 'pending', addresses: null, addresses_type: null, failureNotifiedAt: null,
      })
    })

    it('claimUnbroadcastFailureWithEffects refuses an anchored row and writes no outbox', async () => {
      const id = await insertRow({ hash: 'ABCD' })

      expect(await dal.claimUnbroadcastFailureWithEffects(id, 'gave up')).toBeUndefined()
      expect(await outbox(id)).toMatchObject({ status: 'pending', failureEffects: null })
    })

    it('claimBroadcastFailureWithEffects fails an anchored row with its code and log', async () => {
      const id = await insertRow({ hash: 'ABCD' })

      const row = await dal.claimBroadcastFailureWithEffects(id, { code: 5, log: 'insufficient fee' })

      expect(row).toMatchObject({ id, status: TransactionStatus.Failure, code: 5, log: 'insufficient fee', failureEffects: 'pending' })
      expect(await outbox(id)).toMatchObject({ failureEffects: 'pending', addresses: null })
    })

    it('claimBroadcastFailureWithEffects refuses an unanchored row and writes no outbox', async () => {
      const id = await insertRow()

      expect(await dal.claimBroadcastFailureWithEffects(id, { log: 'x' })).toBeUndefined()
      expect(await outbox(id)).toMatchObject({ status: 'pending', failureEffects: null })
    })

    it('claimVerifierFailureWithEffects stores exactly the failed operators', async () => {
      const id = await insertRow({ hash: 'ABCD' })

      const row = await dal.claimVerifierFailureWithEffects(id, { code: 1, verificationHeight: 10, log: 'absent' }, ['pokt1a', 'pokt1b'])

      expect(row).toMatchObject({
        status: TransactionStatus.Failure, code: 1, verificationHeight: 10, log: 'absent',
        failureEffects: 'pending', failureReleaseAddresses: ['pokt1a', 'pokt1b'],
      })
      expect(await outbox(id)).toMatchObject({ addresses: '["pokt1a", "pokt1b"]', addresses_type: 'array' })
    })

    it('claimVerifierFailureWithEffects stores [] as [], never as NULL', async () => {
      const id = await insertRow({ hash: 'ABCD' })

      const row = await dal.claimVerifierFailureWithEffects(id, { log: 'absent' }, [])

      expect(row?.failureReleaseAddresses).toEqual([])
      expect(await outbox(id)).toMatchObject({ failureEffects: 'pending', addresses: '[]', addresses_type: 'array' })
    })

    it('a CAS whose ack was lost is reported lost on retry, and the outbox it committed stays pending', async () => {
      const unanchored = await insertRow()
      const rejected = await insertRow({ hash: 'ABCD' })
      const verified = await insertRow({ hash: 'EFGH' })
      // The first call commits; its reply never reaches the caller, which retries.
      await dal.claimUnbroadcastFailureWithEffects(unanchored, 'gave up')
      await dal.claimBroadcastFailureWithEffects(rejected, { log: 'rejected' })
      await dal.claimVerifierFailureWithEffects(verified, { log: 'absent' }, ['pokt1a'])

      expect(await dal.claimUnbroadcastFailureWithEffects(unanchored, 'gave up')).toBeUndefined()
      expect(await dal.claimBroadcastFailureWithEffects(rejected, { log: 'rejected' })).toBeUndefined()
      expect(await dal.claimVerifierFailureWithEffects(verified, { log: 'absent' }, ['pokt1a'])).toBeUndefined()

      for (const id of [unanchored, rejected, verified]) {
        expect(await outbox(id)).toMatchObject({ status: 'failure', failureEffects: 'pending' })
      }
    })

    it('B and D on the same row: only the winner writes the outbox (one release owed, not two)', async () => {
      const id = await insertRow({ hash: 'ABCD' })

      const [b, d] = await Promise.all([
        dal.claimBroadcastFailureWithEffects(id, { log: 'rejected' }),
        dal.claimVerifierFailureWithEffects(id, { log: 'absent' }, ['pokt1a']),
      ])

      expect([b, d].filter(Boolean)).toHaveLength(1)
      const stored = await outbox(id)
      expect(stored.failureEffects).toBe('pending')
      // The array is D's only if D won; B never writes one.
      expect(stored.addresses).toBe(d ? '["pokt1a"]' : null)
    })

    it('a row the verifier already closed without effects stays without an outbox', async () => {
      const id = await insertRow({ hash: 'ABCD' })
      await dal.claimTerminalTransition(id, TransactionStatus.Success, { log: 'verified' })

      expect(await dal.claimBroadcastFailureWithEffects(id, { log: 'late' })).toBeUndefined()
      expect(await dal.claimVerifierFailureWithEffects(id, { log: 'late' }, [])).toBeUndefined()
      expect(await outbox(id)).toMatchObject({ status: 'success', failureEffects: null, addresses: null })
    })
  })

  describe('beginRelease (the entry table)', () => {
    it.each([
      ['pending', 'proceed', 'releasing'],
      ['releasing', 'was-releasing', 'manual'],
      ['done', 'nothing', 'done'],
      ['manual', 'nothing', 'manual'],
      [null, 'nothing', null],
    ] as const)('%s → %s, row left %s', async (from, outcome, after) => {
      const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: from })

      expect(await dal.beginRelease(id)).toBe(outcome)
      expect((await outbox(id)).failureEffects).toBe(after)
    })

    it('a second entry after a proceed (retry, restart, second run) never proceeds again', async () => {
      const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: 'pending' })

      expect(await dal.beginRelease(id)).toBe('proceed')
      expect(await dal.beginRelease(id)).toBe('was-releasing')
      expect(await dal.beginRelease(id)).toBe('nothing')
      expect((await outbox(id)).failureEffects).toBe('manual')
    })

    it('two concurrent entries on a pending row: exactly one proceeds', async () => {
      const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: 'pending' })

      const outcomes = await Promise.all([dal.beginRelease(id), dal.beginRelease(id)])

      expect(outcomes.sort()).toEqual(['proceed', 'was-releasing'])
      expect((await outbox(id)).failureEffects).toBe('manual')
    })
  })

  describe('release outcome transitions are CAS-guarded', () => {
    const cases: Array<[string, (dal: Transaction, id: number) => Promise<boolean>, FailureEffectsState[], FailureEffectsState]> = [
      ['releaseNotSent', (d, id) => d.releaseNotSent(id), ['releasing'], 'pending'],
      ['releaseDone', (d, id) => d.releaseDone(id), ['releasing'], 'done'],
      ['releaseManual', (d, id) => d.releaseManual(id), ['releasing'], 'manual'],
      ['noReleaseOwed', (d, id) => d.noReleaseOwed(id), ['pending', 'releasing'], 'done'],
      ['effectsExhausted', (d, id) => d.effectsExhausted(id), ['pending', 'releasing'], 'manual'],
    ]

    for (const [name, call, from, to] of cases) {
      for (const state of STATES) {
        const moves = state !== null && from.includes(state)
        it(`${name} from ${state}: ${moves ? `moves to ${to}` : 'changes nothing'}`, async () => {
          const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: state })

          expect(await call(dal, id)).toBe(moves)
          expect((await outbox(id)).failureEffects).toBe(moves ? to : state)
        })
      }
    }

    it('effectsExhausted on a row another attempt already moved returns false without throwing', async () => {
      const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: 'releasing' })
      await dal.releaseDone(id)

      await expect(dal.effectsExhausted(id)).resolves.toBe(false)
      expect((await outbox(id)).failureEffects).toBe('done')
    })
  })

  describe('claimNotify (the notify fence)', () => {
    it('lets exactly one of many concurrent callers through', async () => {
      const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: 'done' })

      const results = await Promise.all(Array.from({ length: 10 }, () => dal.claimNotify(id)))

      const winners = results.filter(Boolean)
      expect(winners).toHaveLength(1)
      expect(winners[0]).toMatchObject({ id, createdBy: 'pokt1effectstest' })
      expect((await outbox(id)).failureNotifiedAt).toBeInstanceOf(Date)
    })

    it('a manual → pending reset does not reopen the fence', async () => {
      const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: 'manual' })
      expect(await dal.claimNotify(id)).toBeDefined()

      await db.update(transactionsTable).set({ failureEffects: 'pending' }).where(eq(transactionsTable.id, id))

      expect(await dal.claimNotify(id)).toBeUndefined()
    })

    it('never fires for a row that owes no failure effects', async () => {
      const id = await insertRow({ status: TransactionStatus.Failure })

      expect(await dal.claimNotify(id)).toBeUndefined()
      expect((await outbox(id)).failureNotifiedAt).toBeNull()
    })
  })

  describe('listing', () => {
    it('listFailureEffects returns pending and releasing rows, and done/manual rows whose notice never claimed its fence, by id', async () => {
      const ids: Partial<Record<string, number>> = {}
      for (const state of STATES) ids[String(state)] = await insertRow({ status: TransactionStatus.Failure, failureEffects: state })

      // Fence still NULL everywhere: every outbox row is listed, the NULL (nothing owed) row is not.
      expect(await dal.listFailureEffects()).toEqual([
        { id: ids.pending, failureEffects: 'pending' },
        { id: ids.releasing, failureEffects: 'releasing' },
        { id: ids.done, failureEffects: 'done' },
        { id: ids.manual, failureEffects: 'manual' },
      ])
    })

    it('a done or manual row drops out of the listing once its notice claimed the fence; pending/releasing stay', async () => {
      const ids: Partial<Record<string, number>> = {}
      for (const state of STATES) {
        const id = await insertRow({ status: TransactionStatus.Failure, failureEffects: state })
        ids[String(state)] = id
        if (state !== null) expect(await dal.claimNotify(id)).toBeDefined()
      }

      expect(await dal.listFailureEffects()).toEqual([
        { id: ids.pending, failureEffects: 'pending' },
        { id: ids.releasing, failureEffects: 'releasing' },
      ])
    })
  })

  describe('CHECK constraints from 0022', () => {
    it('reject a failureEffects value outside the state set', async () => {
      const id = await insertRow()

      await expect(pool.query(`update transactions set "failureEffects" = 'released' where id = $1`, [id]))
        .rejects.toMatchObject({ constraint: 'transactions_failure_effects_value' })
    })

    it.each([`'{"a":1}'`, `'"pokt1a"'`, `'null'`, `'1'`])('reject failureReleaseAddresses = %s (not an array)', async (value) => {
      const id = await insertRow()

      await expect(pool.query(`update transactions set "failureReleaseAddresses" = ${value}::jsonb where id = $1`, [id]))
        .rejects.toMatchObject({ constraint: 'transactions_failure_release_addresses_array' })
    })

    it('accept SQL NULL, [] and an array of addresses', async () => {
      const id = await insertRow()
      for (const value of [`NULL`, `'[]'::jsonb`, `'["pokt1a"]'::jsonb`]) {
        await pool.query(`update transactions set "failureReleaseAddresses" = ${value} where id = $1`, [id])
      }
      expect(await outbox(id)).toMatchObject({ addresses: '["pokt1a"]' })
    })
  })
})
