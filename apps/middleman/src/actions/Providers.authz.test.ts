jest.mock('server-only', () => ({}))

// The session is the only thing mocked on the auth side: the real requireAuth/requireAdmin
// from lib/utils/actions run, so these tests prove the role check, not a stub.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: async () => ({ chainId: 'pocket' }) }))

const trigger = jest.fn()
const getTemporalClient = jest.fn(() => ({ schedule: { getHandle: () => ({ trigger }) } }))
jest.mock('@/lib/temporal', () => ({ getTemporalClient: () => getTemporalClient() }))

const listAll = jest.fn()
const list = jest.fn()
const update = jest.fn()
const getByIdentity = jest.fn()
const applyGovernanceSync = jest.fn()
const countProviders = jest.fn()
jest.mock('@/lib/dal/providers', () => ({
  listAll: () => listAll(),
  list: (all?: boolean) => list(all),
  update: (identity: string, values: unknown) => update(identity, values),
  getByIdentity: (identity: string) => getByIdentity(identity),
  applyGovernanceSync: (...args: unknown[]) => applyGovernanceSync(...args),
  countProviders: () => countProviders(),
}))

import {
  CountProviders,
  GetProviderByIdentity,
  ListProvidersWithPublicPlans,
  SyncProvidersFromGovernance,
  ListProviders,
  submitProviders,
  TriggerGovernanceSync,
  UpdateEnabled,
  UpdateProvidersFromSource,
  UpdateVisibility,
} from './Providers'
import { UserRole } from '@igniter/db/middleman/enums'

const userSession = { user: { identity: 'pokt1user', role: UserRole.User } }
const ownerSession = { user: { identity: 'pokt1owner', role: UserRole.Owner } }

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue(userSession)
  update.mockImplementation(async (identity: string, values: object) => ({ identity, ...values }))
  list.mockResolvedValue([])
})

describe('submitProviders', () => {
  it('refuses a role user session without writing', async () => {
    await expect(submitProviders({ providers: ['pokt1a'] })).rejects.toThrow('Unauthorized')
    expect(listAll).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(submitProviders({ providers: ['pokt1a'] })).rejects.toThrow('Not logged in')
    expect(update).not.toHaveBeenCalled()
  })

  it('only toggles enabled/visible on existing rows and never writes a client url, name or new identity', async () => {
    auth.mockResolvedValue(ownerSession)
    listAll.mockResolvedValue([
      { id: 1, identity: 'pokt1a', name: 'A', url: 'https://a.example' },
      { id: 2, identity: 'pokt1b', name: 'B', url: 'https://b.example' },
    ])

    // A caller still sending the old second argument: it must be ignored.
    const legacyArgument = [{ id: 9, identity: 'pokt1new', name: 'Other', url: 'http://169.254.169.254/' }]
    await (submitProviders as (...args: unknown[]) => Promise<unknown>)(
      { providers: ['pokt1a', 'pokt1new'] },
      legacyArgument,
    )

    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith('pokt1a', { enabled: true, visible: true, updatedBy: 'pokt1owner' })
    expect(update).toHaveBeenCalledWith('pokt1b', { enabled: false, visible: false, updatedBy: 'pokt1owner' })
    for (const [identity, values] of update.mock.calls) {
      expect(identity).not.toBe('pokt1new')
      expect(Object.keys(values).sort()).toEqual(['enabled', 'updatedBy', 'visible'])
    }
  })
})

describe('provider toggles', () => {
  it('UpdateVisibility refuses a role user session', async () => {
    await expect(UpdateVisibility('pokt1a', true)).rejects.toThrow('Unauthorized')
    expect(update).not.toHaveBeenCalled()
  })

  it('UpdateEnabled refuses a role user session', async () => {
    await expect(UpdateEnabled('pokt1a', true)).rejects.toThrow('Unauthorized')
    expect(update).not.toHaveBeenCalled()
  })

  it('UpdateEnabled works for the owner', async () => {
    auth.mockResolvedValue(ownerSession)
    await UpdateEnabled('pokt1a', false)
    expect(update).toHaveBeenCalledWith('pokt1a', { enabled: false })
  })
})

describe('governance sync triggers', () => {
  it('TriggerGovernanceSync refuses a role user session', async () => {
    await expect(TriggerGovernanceSync()).rejects.toThrow('Unauthorized')
    expect(getTemporalClient).not.toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('UpdateProvidersFromSource refuses a role user session', async () => {
    await expect(UpdateProvidersFromSource()).rejects.toThrow('Unauthorized')
    expect(trigger).not.toHaveBeenCalled()
  })

  it('TriggerGovernanceSync works for the owner', async () => {
    auth.mockResolvedValue(ownerSession)
    await expect(TriggerGovernanceSync()).resolves.toEqual({ success: true })
    expect(trigger).toHaveBeenCalled()
  })
})

describe('provider reads', () => {
  it('ListProviders(true) (hidden providers included) refuses a role user session', async () => {
    await expect(ListProviders(true)).rejects.toThrow('Unauthorized')
    expect(list).not.toHaveBeenCalled()
  })

  it('ListProviders() refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(ListProviders()).rejects.toThrow('Not logged in')
    expect(list).not.toHaveBeenCalled()
  })

  it('ListProviders() serves a role user session only the fields the picker reads', async () => {
    list.mockResolvedValue([{
      id: 1, identity: 'pokt1a', name: 'A', status: 'healthy', enabled: true, visible: true,
      url: 'https://a.example', allowedStakers: ['pokt1s'], rewardAddresses: ['pokt1r'],
      addressGroups: [{ id: 3, private: true, linkedAddresses: ['pokt1l'] }],
    }])
    await expect(ListProviders()).resolves.toEqual([
      { id: 1, identity: 'pokt1a', name: 'A', status: 'healthy', enabled: true, visible: true },
    ])
    expect(list).toHaveBeenCalledWith(undefined)
  })

  it('ListProvidersWithPublicPlans refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(ListProvidersWithPublicPlans([])).rejects.toThrow('Not logged in')
    expect(list).not.toHaveBeenCalled()
  })

  it('CountProviders refuses a role user session', async () => {
    await expect(CountProviders()).rejects.toThrow('Unauthorized')
    expect(countProviders).not.toHaveBeenCalled()
  })

  it('GetProviderByIdentity refuses a role user session', async () => {
    await expect(GetProviderByIdentity('pokt1a')).rejects.toThrow('Unauthorized')
    expect(getByIdentity).not.toHaveBeenCalled()
  })
})

describe('SyncProvidersFromGovernance (action side)', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })

  it('disables the rows that left the source and does not force enabled/visible on updates', async () => {
    auth.mockResolvedValue(ownerSession)
    process.env.PROVIDERS_CDN_URL = 'https://cdn.example/{chainId}/providers.json'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'A2', identity: 'pokt1a', identityHistory: [], url: 'https://a.example' }],
    }) as unknown as typeof fetch
    listAll.mockResolvedValue([
      { id: 1, identity: 'pokt1a', name: 'A', url: 'https://a.example', enabled: false, visible: false },
      { id: 2, identity: 'pokt1gone', name: 'Gone', url: 'https://gone.example', enabled: true, visible: true },
      { id: 3, identity: 'pokt1other', name: 'X', url: 'http://169.254.169.254/', enabled: true, visible: false },
      { id: 4, identity: 'pokt1already', name: 'Off', url: 'https://off.example', enabled: false, visible: false },
    ])

    await SyncProvidersFromGovernance()

    expect(applyGovernanceSync).toHaveBeenCalledWith(
      [],
      [{ id: 1, identity: 'pokt1a', name: 'A2', url: 'https://a.example' }],
      ['pokt1gone', 'pokt1other'],
      'pokt1owner',
    )
  })
})
