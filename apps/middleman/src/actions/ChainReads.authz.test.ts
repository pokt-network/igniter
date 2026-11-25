jest.mock('server-only', () => ({}))

// The chain reads load the configured endpoints from the settings table, so they need a
// session too. Only the session is mocked; the real requireAuth runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const getApplicationSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: () => getApplicationSettings() }))
jest.mock('@igniter/graphql', () => ({ unstakeTimeAvgDocument: {} }))
jest.mock('@igniter/ui/graphql/server', () => ({ getServerApolloClient: jest.fn() }))
jest.mock('@igniter/ui/api/blocks', () => ({ getLatestBlock: jest.fn() }))
jest.mock('@/lib/dal/transaction', () => ({ insert: jest.fn() }))
jest.mock('@/lib/dal/nodes', () => ({ sumStakeAmountByAddresses: jest.fn() }))
jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))

import { GetAccountSequence, GetSupplierStakingFee, SimulateFee } from './Blockchain'
import { GetUnstakeDuration } from './Unstake'

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue(null)
})

describe.each([
  ['GetAccountSequence', () => GetAccountSequence('pokt1abc')],
  ['SimulateFee', () => SimulateFee({ messages: [], signerPubKey: '00' } as unknown as Parameters<typeof SimulateFee>[0])],
  ['GetSupplierStakingFee', () => GetSupplierStakingFee()],
  ['GetUnstakeDuration', () => GetUnstakeDuration()],
])('%s', (_name, call) => {
  it('refuses a request without a session before reading the settings', async () => {
    await expect(call()).rejects.toThrow('Not logged in')
    expect(getApplicationSettings).not.toHaveBeenCalled()
  })
})
