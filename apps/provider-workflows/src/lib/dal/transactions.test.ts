import Transactions from '@/lib/dal/transactions'
import { transactionsTable } from '@igniter/db/provider/schema'

describe('Transactions DAL', () => {
  it('lists pending transaction IDs without selecting full transaction payloads', async () => {
    let selectedFields: unknown
    const rows = [{ id: 101 }, { id: 202 }]
    const query = {
      from: () => query,
      where: async () => rows,
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

    await expect(dal.listPending()).resolves.toEqual([101, 202])
    expect(selectedFields).toEqual({ id: transactionsTable.id })
  })
})
