// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the workflow under test
// ---------------------------------------------------------------------------

const activityMocks = {
  listProviders: jest.fn(),
  processProviderStatus: jest.fn(),
}
const mockProxyActivities = jest.fn((_options: unknown) => activityMocks)
const mockWarn = jest.fn()

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: unknown) => mockProxyActivities(options),
  ApplicationFailure: class MockApplicationFailure extends Error {
    constructor(message: string, public type?: string, public nonRetryable?: boolean) {
      super(message)
    }
  },
  log: { debug: jest.fn(), info: jest.fn(), warn: (...args: unknown[]) => mockWarn(...args), error: jest.fn() },
}))

jest.mock('@/activities', () => ({ delegatorActivities: jest.fn() }))

import { ProviderStatus } from './ProviderStatus'

const providers = [{ identity: 'p1' }, { identity: 'p2' }, { identity: 'p3' }]

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ProviderStatus', () => {
  it('completes and warns when one provider fails while the others succeed', async () => {
    activityMocks.listProviders.mockResolvedValue(providers)
    activityMocks.processProviderStatus.mockImplementation(async (identity: string) => {
      if (identity === 'p2') throw new Error('Bad Gateway')
    })

    await expect(ProviderStatus({})).resolves.toBeUndefined()

    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ identity: 'p2', reason: 'Error: Bad Gateway' }),
    )
  })

  it('fails with a non-retryable fatal_error when every provider fails', async () => {
    activityMocks.listProviders.mockResolvedValue(providers)
    activityMocks.processProviderStatus.mockRejectedValue(new Error('down'))

    const err = await ProviderStatus({}).then(() => undefined, (e: unknown) => e)

    expect(err).toMatchObject({ type: 'fatal_error', nonRetryable: true })
    expect(mockWarn).toHaveBeenCalledTimes(providers.length)
  })

  it('completes without processing anything when there are no providers', async () => {
    activityMocks.listProviders.mockResolvedValue([])

    await expect(ProviderStatus({})).resolves.toBeUndefined()

    expect(activityMocks.processProviderStatus).not.toHaveBeenCalled()
  })

  it('schedules every provider activity even when an early one fails', async () => {
    activityMocks.listProviders.mockResolvedValue(providers)
    activityMocks.processProviderStatus.mockImplementation(async (identity: string) => {
      if (identity === 'p1') throw new Error('Bad Gateway')
    })

    await ProviderStatus({})

    expect(activityMocks.processProviderStatus.mock.calls).toEqual([['p1'], ['p2'], ['p3']])
  })
})
