jest.mock('server-only', () => ({}))

// Only the session is mocked; the real requireAdmin runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))
jest.mock('@igniter/graphql', () => ({ rewardsWindowsDocument: {} }))
jest.mock('@igniter/ui/graphql/server', () => ({ getServerApolloClient: jest.fn() }))
jest.mock('@igniter/ui/api/blocks', () => ({ getLatestBlock: jest.fn() }))
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: jest.fn() }))
const getStakedNodesAddress = jest.fn().mockResolvedValue(['pokt1a'])
jest.mock('@/lib/dal/nodes', () => ({ getStakedNodesAddress: () => getStakedNodesAddress() }))

import { GetStakedNodesAddress } from './Nodes'
import { UserRole } from '@igniter/db/middleman/enums'

describe('GetStakedNodesAddress', () => {
  it('refuses a role user session, even one whose identity the settings row names as owner', async () => {
    auth.mockResolvedValue({ user: { identity: 'pokt1formerowner', role: UserRole.User } })
    await expect(GetStakedNodesAddress()).rejects.toThrow('Unauthorized')
    expect(getStakedNodesAddress).not.toHaveBeenCalled()
  })

  it('serves the owner', async () => {
    auth.mockResolvedValue({ user: { identity: 'pokt1owner', role: UserRole.Owner } })
    await expect(GetStakedNodesAddress()).resolves.toEqual(['pokt1a'])
  })
})
