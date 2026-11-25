jest.mock('server-only', () => ({}))

// The owner gate is not under test here: run the action as the owner.
jest.mock('@/lib/utils/actionUtils', () => ({
  withRequireOwnerOrAdmin: async (action: (user: { identity: string }) => Promise<unknown>) => action({ identity: 'pokt1owner' }),
  withRequireOwner: jest.fn(),
}))
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: async () => ({ chainId: 'pocket' }) }))
jest.mock('@/lib/temporal', () => ({ getTemporalClient: jest.fn() }))

const applyGovernanceSync = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/dal/delegators', () => {
  const actual = jest.requireActual('@/lib/delegatorsCdn')
  return {
    parseCdnDelegators: actual.parseCdnDelegators,
    applyGovernanceSync: (...args: unknown[]) => applyGovernanceSync(...args),
    listAll: async () => [],
    countDelegators: jest.fn(), disableAll: jest.fn(), enableAll: jest.fn(), list: jest.fn(), update: jest.fn(),
  }
})

import { SyncDelegatorsFromGovernance } from './Delegators'

const realFetch = global.fetch
afterEach(() => { global.fetch = realFetch; jest.clearAllMocks() })

function cdn(body: unknown) {
  process.env.DELEGATORS_CDN_URL = 'https://cdn.example/{chainId}/delegators.json'
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch
}

describe('SyncDelegatorsFromGovernance (owner setup)', () => {
  it('inserts the listed delegators enabled', async () => {
    cdn([{ name: 'M', identity: '02abc', identityHistory: [] }])
    await SyncDelegatorsFromGovernance()
    expect(applyGovernanceSync).toHaveBeenCalledWith([{ identity: '02abc', name: 'M' }], [], [], 'pokt1owner', { enableNew: true })
  })

  it('writes nothing when the CDN payload is malformed', async () => {
    cdn([{ name: 'M', identity: 42 }])
    await SyncDelegatorsFromGovernance().catch(() => undefined)
    expect(applyGovernanceSync).not.toHaveBeenCalled()
  })
})
