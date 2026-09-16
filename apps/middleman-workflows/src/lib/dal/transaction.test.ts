import Transaction from '@/lib/dal/transaction'
import { transactionsTable } from '@igniter/db/middleman/schema'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

type Captured = { table?: unknown; set?: Record<string, unknown>; where?: SQL }

/**
 * Minimal drizzle stand-in for `db.update(t).set(v).where(c)`. The condition is captured as the
 * real SQL object drizzle builds, so the tests below render it with the Postgres dialect and
 * assert on the emitted predicate — a mocked client cannot prove the guard any other way.
 */
function fakeClient() {
  const captured: Captured = {}
  const chain = {
    set: (v: Record<string, unknown>) => {
      captured.set = v
      return chain
    },
    where: async (c: SQL) => {
      captured.where = c
    },
  }
  const db = {
    update: (t: unknown) => {
      captured.table = t
      return chain
    },
  }
  return { captured, client: { db } as unknown as ConstructorParameters<typeof Transaction>[0] }
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as ConstructorParameters<typeof Transaction>[1]

function render(where: SQL) {
  return new PgDialect().sqlToQuery(where)
}

describe('Transaction DAL — recordPendingDiagnostics', () => {
  it('writes only the diagnostic fields, guarded on status = pending', async () => {
    const { captured, client } = fakeClient()

    await new Transaction(client, logger).recordPendingDiagnostics(42, { code: 20, log: 'mempool is full' })

    expect(captured.table).toBe(transactionsTable)
    // Never a status flip through this path: the verifier owns terminal writes.
    expect(captured.set).toEqual({ code: 20, log: 'mempool is full' })
    expect(captured.set).not.toHaveProperty('status')

    const { sql, params } = render(captured.where!)
    expect(sql).toContain('"id" = ')
    expect(sql).toContain('"status" = ')
    // Both predicates are bound parameters: the row id and the pending guard.
    expect(params).toEqual(expect.arrayContaining([42, 'pending']))
  })

  it('a verdict already written is left alone: the guard is on the SAME statement, not a prior read', async () => {
    // The guard must live in the UPDATE's WHERE, so a verifier verdict landing between a read
    // and this write cannot be overwritten. A separate select-then-update would not give that.
    const { captured, client } = fakeClient()

    await new Transaction(client, logger).recordPendingDiagnostics(7, { log: 'connect ECONNREFUSED' })

    const { sql } = render(captured.where!)
    expect(sql.match(/"status" = /g)).toHaveLength(1)
  })
})
