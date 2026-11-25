import { delegatorActivities } from './index'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import type { PocketBlockchain } from '@igniter/pocket'

// @temporalio/activity `log` requires an activity context; stub it so the
// activity methods can run under plain jest.
jest.mock('@temporalio/activity', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const row = { id: 42, identity: 'pokt1provider', url: 'http://internal/', addressGroups: [] }

function makeActivities(statusResult: unknown) {
  const updateProvider = jest.fn().mockResolvedValue(undefined)
  const dal = {
    provider: {
      getProvider: jest.fn().mockResolvedValue(row),
      updateProvider,
    },
    // No indexer: the activity stops after the status write.
    appSettings: { getFirst: jest.fn().mockResolvedValue({ indexerApiUrl: null }) },
  } as unknown as DAL
  const providerService = {
    signPayload: jest.fn().mockResolvedValue({ identity: 'mw-id', signature: 'sig' }),
    status: jest.fn().mockResolvedValue(statusResult),
  } as unknown as ProviderService

  return {
    activities: delegatorActivities(dal, {} as PocketBlockchain, providerService),
    updateProvider,
  }
}

describe('processProviderStatus', () => {
  it('has no updateProviders activity (mass assignment of provider rows, removed as dead code)', () => {
    expect(makeActivities(null).activities).not.toHaveProperty('updateProviders')
  })

  it('writes nothing for a provider the governance source does not list', async () => {
    const h = makeActivities(null)
    await expect(h.activities.processProviderStatus('pokt1provider')).resolves.toBeNull()
    expect(h.updateProvider).not.toHaveBeenCalled()
  })

  it("writes the status fields under the row's own id, not the reply's", async () => {
    const h = makeActivities({ id: 999, status: 'healthy', fee: 5 })
    await h.activities.processProviderStatus('pokt1provider')
    expect(h.updateProvider).toHaveBeenCalledWith(42, { status: 'healthy', fee: 5 })
  })

  it('lets a governance source outage fail the activity, so it is retried', async () => {
    const updateProvider = jest.fn()
    const dal = {
      provider: { getProvider: jest.fn().mockResolvedValue(row), updateProvider },
    } as unknown as DAL
    const service = {
      signPayload: jest.fn().mockResolvedValue({ identity: 'mw-id', signature: 'sig' }),
      status: jest.fn().mockRejectedValue(new Error('governance down')),
    } as unknown as ProviderService
    const activities = delegatorActivities(dal, {} as PocketBlockchain, service)

    await expect(activities.processProviderStatus('pokt1provider')).rejects.toThrow('governance down')
    expect(updateProvider).not.toHaveBeenCalled()
  })
})
