jest.mock('server-only', () => ({}))

// Only the session is mocked; the real requireAuth from lib/utils/actions runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const getApplicationSettings = jest.fn()
jest.mock('@/actions/ApplicationSettings', () => ({ getApplicationSettings: () => getApplicationSettings() }))
jest.mock('@/lib/dal/providers', () => ({ list: jest.fn() }))
// Read by the stake creation path (chain id, LCD url); unused by the helpers tested here.
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: jest.fn() }))
jest.mock('@/lib/governance', () => ({ governance: { resolve: jest.fn() } }))
jest.mock('@/lib/dal/transaction', () => ({ insert: jest.fn() }))
jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))

const signPayload = jest.fn()
jest.mock('@igniter/commons/crypto', () => ({
  getCompressedPublicKeyFromAppIdentity: async () => Buffer.from('pubkey'),
  signPayload: (payload: string) => signPayload(payload),
}))

import { CalculateStakeDistribution, CreateSignedMemo } from './Stake'
import { UserRole } from '@igniter/db/middleman/enums'

beforeEach(() => {
  jest.clearAllMocks()
  getApplicationSettings.mockResolvedValue({ delegatorRewardsAddress: 'pokt1server', fee: 3 })
  signPayload.mockResolvedValue(Buffer.from('sig'))
})

describe('CreateSignedMemo', () => {
  it('refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(CreateSignedMemo()).rejects.toThrow('Not logged in')
    expect(signPayload).not.toHaveBeenCalled()
  })

  it('signs the server settings and ignores settings sent by the client', async () => {
    auth.mockResolvedValue({ user: { identity: 'pokt1user', role: UserRole.User } })

    // A client still sending the old request shape.
    const legacyRequest = { settings: { delegatorRewardsAddress: 'pokt1other', fee: 99 } }
    const memo = await (CreateSignedMemo as (...args: unknown[]) => ReturnType<typeof CreateSignedMemo>)(legacyRequest)

    expect(memo).toEqual(expect.objectContaining({ a: 'pokt1server', f: '3' }))
    const signed = signPayload.mock.calls[0][0] as string
    expect(signed).toContain('pokt1server')
    expect(signed).not.toContain('pokt1other')
  })
})

it('CalculateStakeDistribution refuses a request without a session', async () => {
  auth.mockResolvedValue(null)
  await expect(CalculateStakeDistribution(60000, 'pokt1owner')).rejects.toThrow('Not logged in')
  expect(getApplicationSettings).not.toHaveBeenCalled()
})
