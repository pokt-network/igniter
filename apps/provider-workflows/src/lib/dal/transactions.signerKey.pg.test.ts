/**
 * On a real Postgres: migration 0026 strips `signerPrivateKey` from existing
 * transactions.params (both JSON shapes), and the terminal transitions strip it from a
 * legacy row a pre-fix worker may still write. Runs only when MIGRATION_TEST_DATABASE_URL
 * points at a local database whose name contains "test" (it wipes the schema).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as schema from '@igniter/db/provider/schema'
import { TransactionStatus } from '@igniter/db/provider/enums'
import Transactions from '@/lib/dal/transactions'

const serverUrl = process.env.MIGRATION_TEST_DATABASE_URL
const migrationsFolder = path.resolve(__dirname, '../../../../provider/drizzle')
const describeWithDb = serverUrl ? describe : describe.skip
const STRIP_TAG = '0026_strip_tx_signer_keys'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TEST_DATABASE = /test/i

function refuse(reason: string): never {
  throw new Error(`transactions.signerKey.pg.test refuses to run: ${reason}. Point MIGRATION_TEST_DATABASE_URL at a local database whose name contains "test".`)
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

/** A copy of the migrations folder whose journal stops before the strip migration. */
function folderBeforeStrip(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-drizzle-'))
  fs.cpSync(migrationsFolder, dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag !== STRIP_TAG)
  fs.writeFileSync(journalPath, JSON.stringify(journal))
  return dir
}

describeWithDb('transactions.params signer key on real Postgres', () => {
  let db: NodePgDatabase<typeof schema>
  const run = async (query: SQL): Promise<Row[]> => (await db.execute(query)).rows as Row[]
  const insertTx = async (params: string | null, hash: string | null = null): Promise<number> => {
    const [r] = await run(sql`insert into transactions (key_address, type, status, hash, params)
      values ('pokt1a', 'unstake', 'pending', ${hash}, ${params}) returning id`)
    return r!.id as number
  }
  const paramsOf = async (id: number) => (await run(sql`select params from transactions where id = ${id}`))[0]!.params as string | null

  beforeAll(async () => {
    db = drizzle({ connection: serverUrl!, schema }) as NodePgDatabase<typeof schema>
    const rows = await run(sql`select current_database() as db`)
    if (!TEST_DATABASE.test(rows[0]?.db ?? '')) refuse(`connected database "${rows[0]?.db}" does not contain "test"`)
    await run(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await run(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await run(sql`CREATE SCHEMA public`)
  })

  afterAll(async () => {
    await (db as unknown as { $client?: { end: () => Promise<void> } })?.$client?.end()
  })

  it('migration 0026 strips the key from both shapes and leaves other rows intact', async () => {
    await migrate(db, { migrationsFolder: folderBeforeStrip() })
    const tagged = await insertTx(JSON.stringify({ kind: 'unstake', params: { signerPrivateKey: 'sk1', signer: 'pokt1a', operatorAddress: 'pokt1a' }, returnFunds: { mode: 'owner' } }))
    const legacy = await insertTx(JSON.stringify({ signerPrivateKey: 'sk2', signer: 'pokt1a', ownerAddress: 'pokt1o', operatorAddress: 'pokt1a' }))
    const clean = await insertTx(JSON.stringify({ kind: 'unstake', params: { signer: 'pokt1a', operatorAddress: 'pokt1a' }, returnFunds: { mode: 'none' } }))
    const broken = await insertTx('{"signerPrivateKey": "sk3", truncated')
    const empty = await insertTx(null)
    // A shape neither strip path knows: the final sweep must still remove the key.
    const odd = await insertTx(JSON.stringify({ kind: 'stake', nested: { deep: { signerPrivateKey: 'sk4' } } }))

    await migrate(db, { migrationsFolder })

    expect(await paramsOf(odd)).toBeNull()
    expect((await run(sql`select status from transactions where id = ${odd}`))[0]!.status).toBe('failure')
    expect((await run(sql`select count(*)::int as n from transactions where params like '%signerPrivateKey%'`))[0]!.n).toBe(0)

    expect(JSON.parse((await paramsOf(tagged))!)).toEqual({ kind: 'unstake', params: { signer: 'pokt1a', operatorAddress: 'pokt1a' }, returnFunds: { mode: 'owner' } })
    expect(JSON.parse((await paramsOf(legacy))!)).toEqual({ signer: 'pokt1a', ownerAddress: 'pokt1o', operatorAddress: 'pokt1a' })
    expect(await paramsOf(clean)).toBe(JSON.stringify({ kind: 'unstake', params: { signer: 'pokt1a', operatorAddress: 'pokt1a' }, returnFunds: { mode: 'none' } }))
    expect(await paramsOf(broken)).toBeNull()
    expect(await paramsOf(empty)).toBeNull()
  })

  it('migration 0026 fails unsigned pending unstakes with a custom destination, leaves signed ones', async () => {
    await run(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await run(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await run(sql`CREATE SCHEMA public`)
    await migrate(db, { migrationsFolder: folderBeforeStrip() })
    const custom = (signer: boolean) => JSON.stringify({
      kind: 'unstake',
      params: { ...(signer ? { signerPrivateKey: 'sk' } : {}), signer: 'pokt1a', operatorAddress: 'pokt1a' },
      returnFunds: { mode: 'custom', address: 'pokt1other' },
    })
    const unsigned = await insertTx(custom(true))
    const signed = await insertTx(custom(false), 'H')
    await run(sql`update transactions set signed_payload = 'bytes' where id = ${signed}`)
    const owner = await insertTx(JSON.stringify({ kind: 'unstake', params: { signer: 'pokt1a', operatorAddress: 'pokt1a' }, returnFunds: { mode: 'owner' } }))

    await migrate(db, { migrationsFolder })

    const status = async (id: number) => (await run(sql`select status from transactions where id = ${id}`))[0]!.status
    expect(await status(unsigned)).toBe('failure')
    expect(await paramsOf(unsigned)).not.toContain('signerPrivateKey')
    expect(await status(signed)).toBe('pending')
    expect(await status(owner)).toBe('pending')
  })

  it('claimTerminalTransition and abandonIntent strip a legacy key', async () => {
    const dal = new Transactions({ db } as never, logger as never)
    const a = await insertTx(JSON.stringify({ kind: 'stake', params: { signerPrivateKey: 'sk', signer: 'pokt1a' } }), 'H1')
    const b = await insertTx(JSON.stringify({ signerPrivateKey: 'sk', signer: 'pokt1a' }))
    await run(sql`update transactions set key_id = null`)

    await dal.claimTerminalTransition(a, TransactionStatus.Success, { message: 'verified' })
    await dal.abandonIntent(b, { message: 'sign failed' })

    expect(JSON.parse((await paramsOf(a))!)).toEqual({ kind: 'stake', params: { signer: 'pokt1a' } })
    expect(JSON.parse((await paramsOf(b))!)).toEqual({ signer: 'pokt1a' })
  })
})
