jest.mock('server-only', () => ({}))

// Only the session is mocked; the real requireAuth from lib/utils/actions runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const getChangesByNodeId = jest.fn()
const getRecentChangesByUser = jest.fn()
const acknowledgeChanges = jest.fn()
const acknowledgeAllByNode = jest.fn()
jest.mock('@/lib/dal/supplierChanges', () => ({
  getChangesByNodeId: (...args: unknown[]) => getChangesByNodeId(...args),
  getRecentChangesByUser: (...args: unknown[]) => getRecentChangesByUser(...args),
  acknowledgeChanges: (...args: unknown[]) => acknowledgeChanges(...args),
  acknowledgeAllByNode: (...args: unknown[]) => acknowledgeAllByNode(...args),
}))

import { AcknowledgeAllByNode, AcknowledgeChanges, GetRecentChanges, GetSupplierChanges } from './SupplierChanges'
import { UserRole } from '@igniter/db/middleman/enums'

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
})

describe.each([
  ['GetRecentChanges', () => GetRecentChanges(), getRecentChangesByUser],
  ['GetSupplierChanges', () => GetSupplierChanges(7), getChangesByNodeId],
  ['AcknowledgeChanges', () => AcknowledgeChanges([1, 2]), acknowledgeChanges],
  ['AcknowledgeAllByNode', () => AcknowledgeAllByNode(7), acknowledgeAllByNode],
])('%s', (_name, call, dal) => {
  it('refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(call()).rejects.toThrow('Not logged in')
    expect(dal).not.toHaveBeenCalled()
  })

  // The DAL scopes the query to the nodes this identity owns; the SQL itself is not
  // exercised here (no database in the jest suite).
  it("passes the caller's identity to the DAL", async () => {
    await call()
    expect(dal.mock.calls[0]).toContain('pokt1caller')
  })
})
