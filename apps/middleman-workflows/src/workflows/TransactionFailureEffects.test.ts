// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the workflow under test
// ---------------------------------------------------------------------------

const activityMocks = {
  releaseFailedStake: jest.fn(),
  markFailureEffectsExhausted: jest.fn(),
  notifyFailedTransactionOwner: jest.fn(),
}

// Same harness as ExecuteTransaction.test.ts: no @temporalio/testing, the workflow runs as a plain
// async function with its proxies stubbed. Branch logic only — not replay/determinism.
// Each proxyActivities() call's options are captured. Only the release proxy (24h budget) hands out
// the real `releaseFailedStake` and only the notify proxy (30m budget) the real
// `notifyFailedTransactionOwner`, so scheduling either through another proxy throws and the routing
// is pinned, not assumed.
const wrongProxy = (name: string) => jest.fn(() => {
  throw new Error(`${name} scheduled through the wrong proxy`)
})
const mockProxyActivities = jest.fn((options: unknown) => {
  const budget = (options as { scheduleToCloseTimeout?: string }).scheduleToCloseTimeout
  return {
    ...activityMocks,
    releaseFailedStake: budget === '24h' ? activityMocks.releaseFailedStake : wrongProxy('releaseFailedStake'),
    notifyFailedTransactionOwner: budget === '30m' ? activityMocks.notifyFailedTransactionOwner : wrongProxy('notifyFailedTransactionOwner'),
  }
})

jest.mock('@temporalio/workflow', () => {
  class MockActivityFailure extends Error {
    constructor(message: string, public cause?: Error) {
      super(message)
    }
  }
  class MockCancelledFailure extends Error {}
  return {
    proxyActivities: (options: unknown) => mockProxyActivities(options),
    ActivityFailure: MockActivityFailure,
    CancelledFailure: MockCancelledFailure,
    // Same predicate as the SDK's (lib/errors.js in @temporalio/workflow 1.11.7).
    isCancellation: (err: unknown) => err instanceof MockCancelledFailure
      || (err instanceof MockActivityFailure && err.cause instanceof MockCancelledFailure),
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }
})

import { TransactionFailureEffects } from './TransactionFailureEffects'
import { ActivityFailure, CancelledFailure, log } from '@temporalio/workflow'
import { RELEASE_TIMEOUT_MS } from '@/lib/provider'

const TX_ID = 42

/** What Temporal hands the workflow once an activity's schedule-to-close budget ran out. */
function releaseExhausted() {
  return new (ActivityFailure as unknown as new (m: string, c: Error) => Error)(
    'Activity task timed out',
    new Error('activity ScheduleToClose timeout'),
  )
}
const notifyExhausted = releaseExhausted

function cancelledActivity() {
  return new (ActivityFailure as unknown as new (m: string, c: Error) => Error)(
    'Activity cancelled',
    new (CancelledFailure as unknown as new (m: string) => Error)('cancelled'),
  )
}

/** Order in which two jest mocks were first invoked. */
function calledBefore(first: jest.Mock, second: jest.Mock): boolean {
  return first.mock.invocationCallOrder[0]! < second.mock.invocationCallOrder[0]!
}

describe('TransactionFailureEffects', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activityMocks.releaseFailedStake.mockReset()
    activityMocks.markFailureEffectsExhausted.mockReset()
    activityMocks.notifyFailedTransactionOwner.mockReset()
    activityMocks.notifyFailedTransactionOwner.mockResolvedValue(true)
    activityMocks.markFailureEffectsExhausted.mockResolvedValue(true)
  })

  it('notifies the owner, then releases', async () => {
    activityMocks.releaseFailedStake.mockResolvedValue('released')

    const result = await TransactionFailureEffects({ transactionId: TX_ID })

    expect(activityMocks.notifyFailedTransactionOwner).toHaveBeenCalledWith(TX_ID)
    expect(activityMocks.releaseFailedStake).toHaveBeenCalledWith(TX_ID)
    expect(calledBefore(activityMocks.notifyFailedTransactionOwner, activityMocks.releaseFailedStake)).toBe(true)
    expect(activityMocks.markFailureEffectsExhausted).not.toHaveBeenCalled()
    expect(result).toEqual({ transactionId: TX_ID, release: 'released', notified: true })
  })

  it.each(['manual', 'nothing', 'no-release-owed', 'moved-meanwhile'] as const)('returns a %s release outcome as is', async (outcome) => {
    activityMocks.releaseFailedStake.mockResolvedValue(outcome)

    const result = await TransactionFailureEffects({ transactionId: TX_ID })

    expect(activityMocks.notifyFailedTransactionOwner).toHaveBeenCalledWith(TX_ID)
    expect(activityMocks.markFailureEffectsExhausted).not.toHaveBeenCalled()
    expect(result.release).toBe(outcome)
  })

  it('a notice that ran out of attempts is logged with the tx id and the release still runs', async () => {
    activityMocks.notifyFailedTransactionOwner.mockRejectedValue(notifyExhausted())
    activityMocks.releaseFailedStake.mockResolvedValue('released')

    const result = await TransactionFailureEffects({ transactionId: TX_ID })

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('notice'), expect.objectContaining({ transactionId: TX_ID }))
    expect(activityMocks.releaseFailedStake).toHaveBeenCalledWith(TX_ID)
    expect(result).toEqual({ transactionId: TX_ID, release: 'released', notified: false })
  })

  it('does not swallow a cancelled notice: no release', async () => {
    const cancelled = cancelledActivity()
    activityMocks.notifyFailedTransactionOwner.mockRejectedValue(cancelled)

    await expect(TransactionFailureEffects({ transactionId: TX_ID })).rejects.toBe(cancelled)
    expect(activityMocks.releaseFailedStake).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('does not swallow a non-activity error from the notice: no release', async () => {
    const bug = new TypeError('bug in workflow code')
    activityMocks.notifyFailedTransactionOwner.mockRejectedValue(bug)

    await expect(TransactionFailureEffects({ transactionId: TX_ID })).rejects.toBe(bug)
    expect(activityMocks.releaseFailedStake).not.toHaveBeenCalled()
  })

  it('on release exhaustion moves the row to manual and logs an error, after the notice', async () => {
    activityMocks.releaseFailedStake.mockRejectedValue(releaseExhausted())

    const result = await TransactionFailureEffects({ transactionId: TX_ID })

    expect(activityMocks.markFailureEffectsExhausted).toHaveBeenCalledWith(TX_ID)
    expect(calledBefore(activityMocks.notifyFailedTransactionOwner, activityMocks.markFailureEffectsExhausted)).toBe(true)
    expect(log.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ transactionId: TX_ID, moved: true }))
    expect(result).toEqual({ transactionId: TX_ID, release: 'exhausted', notified: true })
  })

  it('does not throw when the exhaustion CAS matched no row', async () => {
    activityMocks.releaseFailedStake.mockRejectedValue(releaseExhausted())
    activityMocks.markFailureEffectsExhausted.mockResolvedValue(false)

    const result = await TransactionFailureEffects({ transactionId: TX_ID })

    expect(result.release).toBe('exhausted')
  })

  it('does not swallow a non-activity error from the release: no manual', async () => {
    const bug = new TypeError('bug in workflow code')
    activityMocks.releaseFailedStake.mockRejectedValue(bug)

    await expect(TransactionFailureEffects({ transactionId: TX_ID })).rejects.toBe(bug)
    expect(activityMocks.markFailureEffectsExhausted).not.toHaveBeenCalled()
  })

  it('does not treat a cancelled release as exhausted', async () => {
    const cancelled = cancelledActivity()
    activityMocks.releaseFailedStake.mockRejectedValue(cancelled)

    await expect(TransactionFailureEffects({ transactionId: TX_ID })).rejects.toBe(cancelled)
    expect(activityMocks.markFailureEffectsExhausted).not.toHaveBeenCalled()
  })

  it('schedules notify with a 30m budget and a 5s→1m backoff, the release with 24h and 10s→10m, exhaustion with 3 attempts', async () => {
    activityMocks.releaseFailedStake.mockResolvedValue('released')

    await TransactionFailureEffects({ transactionId: TX_ID })

    const options = mockProxyActivities.mock.calls.map(([o]) => o as {
      startToCloseTimeout?: string
      scheduleToCloseTimeout?: string
      retry?: Record<string, unknown>
    })
    expect(options).toEqual([
      {
        startToCloseTimeout: '30s',
        scheduleToCloseTimeout: '30m',
        retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '1m' },
      },
      {
        startToCloseTimeout: '60s',
        scheduleToCloseTimeout: '24h',
        retry: { initialInterval: '10s', backoffCoefficient: 2, maximumInterval: '10m' },
      },
      { startToCloseTimeout: '30s', retry: { maximumAttempts: 3 } },
    ])
  })

  it('the release POST timeout fits inside the release activity startToCloseTimeout', async () => {
    activityMocks.releaseFailedStake.mockResolvedValue('released')

    await TransactionFailureEffects({ transactionId: TX_ID })

    const release = mockProxyActivities.mock.calls
      .map(([o]) => o as { startToCloseTimeout: string; scheduleToCloseTimeout?: string })
      .find((o) => o.scheduleToCloseTimeout === '24h')!
    const seconds = /^(\d+)s$/.exec(release.startToCloseTimeout)
    expect(seconds).not.toBeNull()
    expect(RELEASE_TIMEOUT_MS).toBeLessThan(Number(seconds![1]) * 1000)
  })
})
