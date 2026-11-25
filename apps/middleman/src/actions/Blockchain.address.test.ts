jest.mock('server-only', () => ({}))

// Only the session is mocked; the real requireAuth runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const getApplicationSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: () => getApplicationSettings() }))

import { toBech32 } from '@cosmjs/encoding'
import { GetAccountSequence } from './Blockchain'
import { UserRole } from '@igniter/db/middleman/enums'

const fetchMock = jest.fn()
const ADDRESS = toBech32('pokt', new Uint8Array(20).fill(3))

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
  getApplicationSettings.mockResolvedValue({ pocketApiUrl: 'https://api.example' })
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account: { account_number: '4', sequence: '9' } }) })
})

describe('GetAccountSequence', () => {
  it('reads the account of a pokt address', async () => {
    await expect(GetAccountSequence(ADDRESS)).resolves.toEqual({ accountNumber: 4, sequence: 9 })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example/cosmos/auth/v1beta1/accounts/${ADDRESS}`,
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it.each([
    ['no account number', { account: { sequence: '9' } }],
    ['a non-numeric account number', { account: { account_number: 'x', sequence: '9' } }],
    ['no account', {}],
  ])('refuses an account with %s', async (_label, body) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => body })
    await expect(GetAccountSequence(ADDRESS)).rejects.toThrow('The chain returned no valid account number')
  })

  it.each([
    ['a path traversal', '../../../cosmos/bank/v1beta1/supply'],
    ['a query string', `${ADDRESS}?x=1`],
    ['another chain prefix', toBech32('cosmos', new Uint8Array(20).fill(3))],
    ['a 32-byte payload', toBech32('pokt', new Uint8Array(32).fill(3))],
    ['a non-string', 42],
  ])('refuses %s without fetching', async (_label, address) => {
    await expect(GetAccountSequence(address as string)).rejects.toThrow('Invalid address')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
