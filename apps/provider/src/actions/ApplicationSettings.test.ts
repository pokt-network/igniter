jest.mock('server-only', () => ({}))

import { UserRole } from '@igniter/db/provider/enums'

// Only the session is mocked: the real requireOwner runs, so these tests prove
// the role check itself.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

jest.mock('@/config/env', () => ({ env: { MINIMUM_STAKE_BUFFER: 0 } }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
// url-join ships ESM only, which this jest setup does not transform.
jest.mock('url-join', () => ({
  __esModule: true,
  default: (...parts: string[]) => parts.map((p) => p.replace(/^\/+|\/+$/g, '')).join('/'),
}))

const SETTINGS_ROW = {
  id: 1,
  name: 'Provider',
  chainId: 'pocket',
  ownerEmail: 'owner@example.com',
  ownerIdentity: 'pokt1owner',
  pocketApiUrl: 'http://internal-api:1317',
  pocketRpcUrl: 'http://internal-rpc:26657',
  indexerApiUrl: 'http://internal-indexer/graphql',
  rewardAddresses: ['pokt1reward'],
  isBootstrapped: true,
  updatedAtHeight: '10',
}
const getApplicationSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: () => getApplicationSettings(),
  insertApplicationSettings: jest.fn(),
  updateApplicationSettings: jest.fn(),
}))

const apolloQuery = jest.fn()
const getServerApolloClient = jest.fn<{ query: jest.Mock }, [string]>(() => ({ query: apolloQuery }))
jest.mock('@igniter/ui/graphql/server', () => ({
  getServerApolloClient: (url: string) => getServerApolloClient(url),
}))

import * as actions from './ApplicationSettings'
import {
  GetApplicationSettings,
  GetPublicApplicationSettings,
  RetrieveBlockchainSettings,
  RetrieveIndexerNetwork,
  ValidateIndexerUrl,
  ValidateRpcEndpoint,
} from './ApplicationSettings'

const originalFetch = globalThis.fetch
let mockFetch: jest.Mock

beforeEach(() => {
  auth.mockReset()
  getApplicationSettings.mockReset().mockResolvedValue(SETTINGS_ROW)
  apolloQuery.mockReset().mockResolvedValue({ data: { status: { chain: 'pocket' } } })
  getServerApolloClient.mockClear()
  mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { node_info: { network: 'pocket' } } }),
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

const sessions: Array<[string, unknown]> = [
  ['no session', null],
  ['a non-owner session', { user: { identity: 'pokt1someone', role: UserRole.User } }],
]

describe.each(sessions)('settings validators with %s', (_label, session) => {
  beforeEach(() => auth.mockResolvedValue(session))

  it('ValidateRpcEndpoint refuses without fetching the url', async () => {
    const result = await ValidateRpcEndpoint('http://169.254.169.254')
    expect(result.success).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('RetrieveBlockchainSettings refuses without fetching the url', async () => {
    const result = await RetrieveBlockchainSettings('http://169.254.169.254', null)
    expect(result.success).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('RetrieveIndexerNetwork refuses without querying the url', async () => {
    await expect(RetrieveIndexerNetwork('http://169.254.169.254')).rejects.toThrow()
    expect(getServerApolloClient).not.toHaveBeenCalled()
    expect(apolloQuery).not.toHaveBeenCalled()
  })

  it('ValidateIndexerUrl refuses without querying the url', async () => {
    const result = await ValidateIndexerUrl('http://169.254.169.254')
    expect(result.success).toBe(false)
    expect(getServerApolloClient).not.toHaveBeenCalled()
    expect(apolloQuery).not.toHaveBeenCalled()
  })

  it('GetApplicationSettings refuses the full row', async () => {
    await expect(GetApplicationSettings()).rejects.toThrow()
    expect(getApplicationSettings).not.toHaveBeenCalled()
  })

  it('GetPublicApplicationSettings returns only the pre-login fields', async () => {
    const result = await GetPublicApplicationSettings()
    expect(result).toEqual({ chainId: 'pocket' })
  })
})

describe('settings validators with the owner session', () => {
  beforeEach(() => auth.mockResolvedValue({ user: { identity: 'pokt1owner', role: UserRole.Owner } }))

  it('ValidateRpcEndpoint checks the url', async () => {
    const result = await ValidateRpcEndpoint('http://node:26657')
    expect(result).toEqual({ success: true, network: 'pocket' })
    expect(mockFetch).toHaveBeenCalledWith('http://node:26657/status', expect.anything())
  })

  it('RetrieveBlockchainSettings reads the chain params', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ params: { min_stake: { amount: '1000000' } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ default_node_info: { network: 'pocket' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ height: '42' }) })
    const result = await RetrieveBlockchainSettings('http://node:1317', null)
    expect(result).toMatchObject({ success: true, network: 'pocket', height: '42', minStake: 1 })
  })

  it('RetrieveIndexerNetwork and ValidateIndexerUrl query the indexer', async () => {
    await expect(RetrieveIndexerNetwork('http://indexer')).resolves.toBe('pocket')
    await expect(ValidateIndexerUrl('http://indexer')).resolves.toEqual({ success: true })
  })

  it('GetApplicationSettings returns the full row', async () => {
    await expect(GetApplicationSettings()).resolves.toEqual(SETTINGS_ROW)
  })
})

it('no longer exports the dead ValidateBlockchainRPC', () => {
  expect((actions as Record<string, unknown>).ValidateBlockchainRPC).toBeUndefined()
})
