import { governanceActivities } from './index'
import type DAL from '@/lib/dal/DAL'
import { lookup } from 'node:dns/promises'

jest.mock('@temporalio/activity', () => {
  class ApplicationFailure extends Error {
    type?: string
    nonRetryable?: boolean
    static nonRetryable(message: string, type: string) {
      const e = new ApplicationFailure(message); e.type = type; e.nonRetryable = true; return e
    }
    static retryable(message: string, type: string) {
      const e = new ApplicationFailure(message); e.type = type; return e
    }
  }
  return { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }, ApplicationFailure }
})
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
;(lookup as jest.Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

const fetchMock = jest.fn()
const realFetch = global.fetch
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.PROVIDERS_CDN_URL = 'https://cdn.example/{chainId}/providers.json'
  delete process.env.GOVERNANCE_MAX_CHANGES_PER_RUN
})
afterAll(() => { global.fetch = realFetch })

const cdnRow = (identity: string, url = `https://${identity}.example`) => ({ name: identity, identity, identityHistory: [], url })
const dbRow = (identity: string) => ({ identity, name: identity, url: `https://${identity}.example`, enabled: true, visible: true })

function setup(current: unknown[]) {
  const upsertFromGovernance = jest.fn().mockResolvedValue({ inserted: 0, updated: 0, disabled: 0 })
  const dal = {
    appSettings: { getFirst: jest.fn().mockResolvedValue({ chainId: 'pocket', ownerIdentity: 'owner' }) },
    provider: { listAll: jest.fn().mockResolvedValue(current), upsertFromGovernance },
  } as unknown as DAL
  return { activities: governanceActivities(dal), upsertFromGovernance }
}

describe('syncProvidersFromGovernance', () => {
  it('passes only validated rows to the DAL, with a fetch timeout', async () => {
    const { activities, upsertFromGovernance } = setup([])
    fetchMock.mockResolvedValue(new Response(JSON.stringify([cdnRow('a'), cdnRow('b', 'http://b.example')])))
    await activities.syncProvidersFromGovernance()
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    expect(upsertFromGovernance).toHaveBeenCalledWith([cdnRow('a')], 'owner')
  })

  it('refuses a run that changes more providers than the cap', async () => {
    process.env.GOVERNANCE_MAX_CHANGES_PER_RUN = '2'
    const { activities, upsertFromGovernance } = setup([dbRow('a'), dbRow('b'), dbRow('c')])
    // Empty list => would disable all 3.
    fetchMock.mockResolvedValue(new Response(JSON.stringify([])))
    await expect(activities.syncProvidersFromGovernance()).rejects.toMatchObject({ type: 'change_cap_exceeded' })
    expect(upsertFromGovernance).not.toHaveBeenCalled()
  })

  it('does not cap the initial seed of an empty table', async () => {
    process.env.GOVERNANCE_MAX_CHANGES_PER_RUN = '1'
    const { activities, upsertFromGovernance } = setup([])
    fetchMock.mockResolvedValue(new Response(JSON.stringify([cdnRow('a'), cdnRow('b'), cdnRow('c')])))
    await activities.syncProvidersFromGovernance()
    expect(upsertFromGovernance).toHaveBeenCalled()
  })

  it('rejects a non-array payload as non-retryable', async () => {
    const { activities } = setup([])
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ unexpected: true })))
    await expect(activities.syncProvidersFromGovernance()).rejects.toMatchObject({ type: 'invalid_payload' })
  })
})
