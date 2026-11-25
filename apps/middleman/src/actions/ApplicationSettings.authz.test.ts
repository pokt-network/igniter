jest.mock('server-only', () => ({}))
// url-join ships ESM only, which ts-jest does not transform; a minimal stand-in is enough here.
jest.mock('url-join', () => ({
  __esModule: true,
  default: (...parts: string[]) =>
    parts.map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+/, ''))).join('/'),
}))

// Only the session is mocked; the real requireAdmin from lib/utils/actions runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/config/env', () => ({ env: { MINIMUM_STAKE_BUFFER: 0 } }))
jest.mock('@igniter/graphql', () => ({ indexerStatusDocument: {} }))

const query = jest.fn()
const getServerApolloClient = jest.fn((_url: string) => ({ query }))
jest.mock('@igniter/ui/graphql/server', () => ({
  getServerApolloClient: (url: string) => getServerApolloClient(url),
}))

const getApplicationSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: () => getApplicationSettings(),
  insertApplicationSettings: jest.fn(),
  updateApplicationSettings: jest.fn(),
}))

import {
  getApplicationSettings as getPublicApplicationSettings,
  GetFullApplicationSettings,
  RetrieveBlockchainSettings,
  RetrieveIndexerNetwork,
  ValidateBlockchainRPC,
  ValidateIndexerUrl,
  ValidateRpcEndpoint,
} from './ApplicationSettings'
import { UserRole } from '@igniter/db/middleman/enums'

const fetchMock = jest.fn()
const internalUrl = 'http://169.254.169.254/latest'

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ user: { identity: 'pokt1user', role: UserRole.User } })
  getApplicationSettings.mockResolvedValue({ chainId: 'pocket', updatedAtHeight: null })
  global.fetch = fetchMock as unknown as typeof fetch
})

// Each of these fetches a url the caller chooses, so none may run for a non-owner.
describe.each([
  ['RetrieveBlockchainSettings', () => RetrieveBlockchainSettings(internalUrl, null)],
  ['RetrieveIndexerNetwork', () => RetrieveIndexerNetwork(internalUrl)],
  ['ValidateBlockchainRPC', () => ValidateBlockchainRPC(internalUrl)],
  ['ValidateRpcEndpoint', () => ValidateRpcEndpoint(internalUrl)],
  ['ValidateIndexerUrl', () => ValidateIndexerUrl(internalUrl)],
])('%s', (_name, call) => {
  it('refuses a role user session without fetching the url', async () => {
    await expect(call()).rejects.toThrow('Unauthorized')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getServerApolloClient).not.toHaveBeenCalled()
  })

  it('refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(call()).rejects.toThrow('Not logged in')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getServerApolloClient).not.toHaveBeenCalled()
  })
})

it('ValidateRpcEndpoint still runs for the owner', async () => {
  auth.mockResolvedValue({ user: { identity: 'pokt1owner', role: UserRole.Owner } })
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { node_info: { network: 'pocket' } } }) })

  await expect(ValidateRpcEndpoint('https://rpc.example')).resolves.toEqual({ success: true, network: 'pocket' })
  expect(fetchMock).toHaveBeenCalledWith('https://rpc.example/status', expect.anything())
})

describe('settings reads', () => {
  const row = {
    name: 'Igniter', chainId: 'pocket', fee: 1, minimumStake: 60000, delegatorRewardsAddress: 'pokt1d',
    ownerEmail: 'owner@example.com', pocketApiUrl: 'http://lcd.internal', pocketRpcUrl: 'http://rpc.internal',
    indexerApiUrl: 'http://indexer.internal', createdBy: 'pokt1owner', updatedBy: 'pokt1owner',
  }

  it('the public read leaves out the owner email, the internal endpoints and the audit columns', async () => {
    auth.mockResolvedValue(null)
    getApplicationSettings.mockResolvedValue(row)
    await expect(getPublicApplicationSettings()).resolves.toEqual({
      name: 'Igniter', chainId: 'pocket', fee: 1, minimumStake: 60000, delegatorRewardsAddress: 'pokt1d',
    })
  })

  it('the full read refuses a role user session', async () => {
    getApplicationSettings.mockResolvedValue(row)
    await expect(GetFullApplicationSettings()).rejects.toThrow('Unauthorized')
  })

  it('the full read gives the owner the whole row', async () => {
    auth.mockResolvedValue({ user: { identity: 'pokt1owner', role: UserRole.Owner } })
    getApplicationSettings.mockResolvedValue(row)
    await expect(GetFullApplicationSettings()).resolves.toEqual(row)
  })
})
