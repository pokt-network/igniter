/**
 * The getTransaction activity result is recorded in the ExecuteTransaction
 * workflow history, and that workflow reads only `status` and `hash`. These
 * tests drive the activity through the real Transactions DAL over a fake DB
 * client that holds a full row, and assert only those two fields come back.
 */

// Mock heavy external dependencies that aren't relevant to these unit tests
jest.mock('@igniter/pocket', () => ({}))
jest.mock('@temporalio/activity', () => ({
  ApplicationFailure: { nonRetryable: jest.fn(), retryable: jest.fn() },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('@igniter/domain/provider/operations', () => ({
  BuildSupplierServiceConfigHandler: jest.fn(),
  CompareSupplierServiceConfigHandler: jest.fn(),
}))
jest.mock('@igniter/domain/provider/utils', () => ({
  getExpectedServicesFromKey: jest.fn(),
}))
jest.mock('@/lib/utils', () => ({
  addOrUpdateRemediationHistory: jest.fn(),
}))
jest.mock('@/lib/redactors', () => ({
  redactStakeSupplierParams: jest.fn(),
}))
jest.mock('@igniter/pocket/proto/pocket/shared/supplier', () => ({
  ServiceConfigUpdate: {},
}))

import { providerActivities } from './index'
import Transactions from '@/lib/dal/transactions'
import { TransactionStatus } from '@igniter/db/provider/enums'

type Row = Record<string, unknown>

const fullRow: Row = {
  id: 5,
  keyId: 10,
  keyAddress: 'pokt1addr',
  status: TransactionStatus.Pending,
  hash: 'DEADBEEF',
  signedPayload: 'signed-bytes',
  params: JSON.stringify({ kind: 'stake', params: { signerPrivateKey: 'secret-key-hex' } }),
}

// Fake DB client over one in-memory table. The relational query API returns
// whole rows; the select builder returns only the requested keys (or whole rows
// when called without fields), like Drizzle does.
function makeActivities(rows: Row[]) {
  const db = {
    query: { transactionsTable: { findFirst: async () => rows[0] } },
    select: (fields?: Row) => {
      const pick = (r: Row) => (fields ? Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]])) : r)
      const q = {
        from: () => q,
        where: () => q,
        limit: async (n: number) => rows.slice(0, n).map(pick),
      }
      return q
    },
  }
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const dal = { transactions: new Transactions({ db } as never, logger as never) }
  return providerActivities(dal as never, {} as never)
}

describe('getTransaction activity', () => {
  it('returns exactly status and hash, never params or the signer key', async () => {
    const result = await makeActivities([fullRow]).getTransaction(5)

    expect(result).toEqual({ status: TransactionStatus.Pending, hash: 'DEADBEEF' })
    expect(Object.keys(result ?? {}).sort()).toEqual(['hash', 'status'])
    expect(JSON.stringify(result)).not.toContain('signerPrivateKey')
  })

  it('returns undefined when the transaction does not exist', async () => {
    await expect(makeActivities([]).getTransaction(99)).resolves.toBeUndefined()
  })
})
