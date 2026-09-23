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
