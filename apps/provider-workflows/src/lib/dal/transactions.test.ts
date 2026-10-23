import Transactions from '@/lib/dal/transactions'
import { transactionsTable } from '@igniter/db/provider/schema'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

describe('Transactions DAL', () => {
  it('lists pending transaction ID objects without selecting full transaction payloads', async () => {
    let selectedFields: unknown
    let selectedTable: unknown
    let pendingFilter: SQL | undefined
    const rows = [{ id: 101 }, { id: 202 }]
    const query = {
      from: (table: unknown) => {
        selectedTable = table
        return query
      },
      where: async (condition: SQL) => {
        pendingFilter = condition
        return rows
      },
    }
    const dbClient = {
      db: {
        select: (fields: unknown) => {
          selectedFields = fields
          return query
        },
      },
    }
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

    const dal = new Transactions(dbClient as never, logger as never)

    await expect(dal.listPending()).resolves.toEqual([{ id: 101 }, { id: 202 }])
    expect(selectedFields).toEqual({ id: transactionsTable.id })
    expect(selectedTable).toBe(transactionsTable)
    expect(pendingFilter).toBeDefined()
    const { sql, params } = new PgDialect().sqlToQuery(pendingFilter!)
    expect(sql).toContain('"status" = ')
    expect(params).toContain('pending')
  })
})

describe('Transactions DAL getTransactionStatus', () => {
  function makeDal(rows: unknown[]) {
    const captured: { fields?: unknown; table?: unknown; where?: SQL; limit?: number } = {}
    const query = {
      from: (table: unknown) => {
        captured.table = table
        return query
      },
      where: (condition: SQL) => {
        captured.where = condition
        return query
      },
      limit: async (n: number) => {
        captured.limit = n
        return rows
      },
    }
    const dbClient = {
      db: {
        select: (fields: unknown) => {
          captured.fields = fields
          return query
        },
      },
    }
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    return { dal: new Transactions(dbClient as never, logger as never), captured }
  }

  it('selects only the status and hash columns for one transaction id', async () => {
    const { dal, captured } = makeDal([{ status: 'pending', hash: 'ABC' }])

    await expect(dal.getTransactionStatus(42)).resolves.toEqual({ status: 'pending', hash: 'ABC' })
    expect(captured.fields).toEqual({ status: transactionsTable.status, hash: transactionsTable.hash })
    expect(captured.table).toBe(transactionsTable)
    expect(captured.limit).toBe(1)
    const { sql, params } = new PgDialect().sqlToQuery(captured.where!)
    expect(sql).toContain('"id" = ')
    expect(params).toEqual([42])
  })

  it('returns undefined when no row matches', async () => {
    const { dal } = makeDal([])
    await expect(dal.getTransactionStatus(7)).resolves.toBeUndefined()
  })
})
