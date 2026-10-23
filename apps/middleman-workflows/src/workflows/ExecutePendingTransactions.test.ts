// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the workflow under test
// ---------------------------------------------------------------------------

const activityMocks = {
  listTransactions: jest.fn(),
  listDispatchableTransactions: jest.fn(),
  getBlockHeight: jest.fn(),
  recordDispatchAttempt: jest.fn(),
  claimUnbroadcastFailure: jest.fn(),
}
const effectMocks = {
  getTransaction: jest.fn(),
  notifyProviderOfFailedStakes: jest.fn(),
  notifyUserOfFailedTransaction: jest.fn(),
}

// No workflow test harness in this repo (see ExecuteTransaction.test.ts): the workflow runs as a
// plain async function with its activity proxies stubbed. This covers the branch logic; the
// Temporal semantics it relies on (startChild + ABANDON, AlreadyStarted, workflowExecutionTimeout
// on a task-wedged child, ALLOW_DUPLICATE_FAILED_ONLY after a timeout) were checked against a
// Temporal dev server when this was written, not here.
const mockPatched = jest.fn(() => true)
const mockStartChild = jest.fn()
const mockExecuteChild = jest.fn()
// The effects proxy is the one built from GIVE_UP_EFFECTS_OPTIONS.
const mockProxyActivities = jest.fn((options: unknown) =>
  options === GIVE_UP_EFFECTS_OPTIONS ? effectMocks : activityMocks)

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: unknown) => mockProxyActivities(options),
  startChild: (...args: unknown[]) => mockStartChild(...args),
  executeChild: (...args: unknown[]) => mockExecuteChild(...args),
  patched: (...args: unknown[]) => mockPatched(...(args as [])),
  WorkflowIdReusePolicy: { ALLOW_DUPLICATE_FAILED_ONLY: 'ALLOW_DUPLICATE_FAILED_ONLY' },
  ParentClosePolicy: { ABANDON: 'ABANDON' },
  ApplicationFailure: class MockApplicationFailure extends Error {},
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
// p-limit is ESM-only. This stand-in really limits, so the concurrency bound is asserted.
jest.mock('p-limit', () => (concurrency: number) => {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= concurrency) return
    const run = queue.shift()
    if (run) run()
  }
  return <T>(fn: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active++
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--
        next()
      })
    })
    next()
  })
})

import {
  CHILD_EXECUTION_TIMEOUT,
  ExecutePendingTransactions,
  GIVE_UP_EFFECTS_OPTIONS,
  GIVE_UP_LOG,
  GIVE_UP_MIN_AGE_MS,
  GIVE_UP_MIN_ATTEMPTS,
} from './ExecutePendingTransactions'
import { TransactionType } from '@igniter/db/middleman/enums'
import { log } from '@temporalio/workflow'

const CREATED = '2026-10-22T20:08:18.026Z'
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 519, createdAt: CREATED, dispatchAttempts: 0, firstAttemptAgeMs: null, ...overrides,
})
const STUCK = { dispatchAttempts: GIVE_UP_MIN_ATTEMPTS, firstAttemptAgeMs: GIVE_UP_MIN_AGE_MS + 1 }
const alreadyStarted = () => Object.assign(new Error('already started'), { name: 'WorkflowExecutionAlreadyStartedError' })

beforeEach(() => {
  // reset, not clear: a mockRejectedValue set by one test must not leak into the next
  jest.resetAllMocks()
  mockProxyActivities.mockImplementation((options) => (options === GIVE_UP_EFFECTS_OPTIONS ? effectMocks : activityMocks))
  mockPatched.mockReturnValue(true)
  activityMocks.listDispatchableTransactions.mockResolvedValue([row()])
  activityMocks.getBlockHeight.mockResolvedValue(1000)
  activityMocks.recordDispatchAttempt.mockResolvedValue(1)
  activityMocks.claimUnbroadcastFailure.mockResolvedValue(true)
  mockStartChild.mockResolvedValue({ firstExecutionRunId: 'run-1' })
  effectMocks.getTransaction.mockResolvedValue({ id: 519, type: TransactionType.Stake, status: 'pending', hash: null })
})

describe('ExecutePendingTransactions v3 — starting children', () => {
  it('starts ExecuteTransaction without waiting for it, with the pre-v3 id and a timeout covering all retries', async () => {
    await ExecutePendingTransactions({})

    expect(mockExecuteChild).not.toHaveBeenCalled()
    expect(mockStartChild).toHaveBeenCalledWith('ExecuteTransaction', expect.objectContaining({
      workflowId: `ExecuteTransaction-519-${CREATED}`,
      args: [{ transactionId: 519 }],
      workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
      parentClosePolicy: 'ABANDON',
      workflowExecutionTimeout: CHILD_EXECUTION_TIMEOUT,
    }))
  })

  it('counts one attempt for the started run, keyed on its run id', async () => {
    await ExecutePendingTransactions({})

    expect(activityMocks.recordDispatchAttempt).toHaveBeenCalledWith(519, 'run-1')
  })

  it('a child that is still running is skipped and not counted', async () => {
    mockStartChild.mockRejectedValue(alreadyStarted())

    await ExecutePendingTransactions({})

    expect(activityMocks.recordDispatchAttempt).not.toHaveBeenCalled()
  })

  it('during an RPC outage it still starts children but counts nothing and gives up on nothing', async () => {
    activityMocks.getBlockHeight.mockRejectedValue(new Error('rpc down'))
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])

    await ExecutePendingTransactions({})

    expect(mockStartChild).toHaveBeenCalled()
    expect(activityMocks.recordDispatchAttempt).not.toHaveBeenCalled()
    expect(activityMocks.claimUnbroadcastFailure).not.toHaveBeenCalled()
  })

  it('warns when a row is relaunched, so a give-up countdown is visible', async () => {
    activityMocks.recordDispatchAttempt.mockResolvedValue(2)

    await ExecutePendingTransactions({})

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('relaunched'), expect.objectContaining({ transactionId: 519, attempts: 2 }))
  })

  it('a failure to record the attempt does not fail the run (the child is running anyway)', async () => {
    activityMocks.recordDispatchAttempt.mockRejectedValue(new Error('db blip'))

    await expect(ExecutePendingTransactions({})).resolves.toBeUndefined()
  })

  it('bounds concurrent starts by the dispatcher limit', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue(Array.from({ length: 25 }, (_, i) => row({ id: 1000 + i })))
    const starts = { active: 0, max: 0 }
    mockStartChild.mockImplementation(async () => {
      starts.active++
      starts.max = Math.max(starts.max, starts.active)
      await new Promise((r) => setTimeout(r, 2))
      starts.active--
      return { firstExecutionRunId: 'run-x' }
    })

    await ExecutePendingTransactions({})

    expect(mockStartChild).toHaveBeenCalledTimes(25)
    expect(starts.max).toBeGreaterThan(1)
    expect(starts.max).toBeLessThanOrEqual(10)
  })

  it('fails the run only when not a single child could be started', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(), row({ id: 600 })])
    mockStartChild.mockRejectedValue(new Error('temporal unavailable'))

    await expect(ExecutePendingTransactions({})).rejects.toThrow('no child workflow could be started')
  })

  it('a batch where some children are already running is not a failure', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(), row({ id: 600 })])
    mockStartChild.mockRejectedValueOnce(alreadyStarted()).mockRejectedValueOnce(new Error('temporal unavailable'))

    await expect(ExecutePendingTransactions({})).resolves.toBeUndefined()
  })
})

describe('ExecutePendingTransactions v3 — giving up', () => {
  it('fails a row with enough attempts over enough time, through the CAS, then notifies provider and user', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])

    await ExecutePendingTransactions({})

    expect(activityMocks.claimUnbroadcastFailure).toHaveBeenCalledWith(519, GIVE_UP_LOG)
    expect(mockStartChild).not.toHaveBeenCalled()
    expect(effectMocks.notifyProviderOfFailedStakes).toHaveBeenCalledWith(519)
    expect(effectMocks.notifyUserOfFailedTransaction).toHaveBeenCalledWith(519, expect.any(String))
    // The CAS proves the give-up happened, so it comes first.
    expect(activityMocks.claimUnbroadcastFailure.mock.invocationCallOrder[0])
      .toBeLessThan(effectMocks.notifyUserOfFailedTransaction.mock.invocationCallOrder[0]!)
  })

  it.each([
    ['too few attempts', { dispatchAttempts: GIVE_UP_MIN_ATTEMPTS - 1, firstAttemptAgeMs: GIVE_UP_MIN_AGE_MS + 1 }],
    ['not old enough', { dispatchAttempts: GIVE_UP_MIN_ATTEMPTS + 10, firstAttemptAgeMs: GIVE_UP_MIN_AGE_MS - 1 }],
    ['never attempted', { dispatchAttempts: 0, firstAttemptAgeMs: null }],
  ])('keeps dispatching a row with %s', async (_label, state) => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(state)])

    await ExecutePendingTransactions({})

    expect(activityMocks.claimUnbroadcastFailure).not.toHaveBeenCalled()
    expect(mockStartChild).toHaveBeenCalled()
  })

  it('a lost CAS (anchored or settled meanwhile) sends no notifications', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])
    activityMocks.claimUnbroadcastFailure.mockResolvedValue(false)

    await ExecutePendingTransactions({})

    expect(effectMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(effectMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
  })

  it('does not notify the provider for an Unstake', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])
    effectMocks.getTransaction.mockResolvedValue({ id: 519, type: TransactionType.Unstake })

    await ExecutePendingTransactions({})

    expect(effectMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(effectMocks.notifyUserOfFailedTransaction).toHaveBeenCalled()
  })

  it('notifications that still fail after their retries are logged for a person, not lost silently', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])
    effectMocks.notifyUserOfFailedTransaction.mockRejectedValue(new Error('smtp down'))

    await expect(ExecutePendingTransactions({})).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('notify by hand'), expect.objectContaining({ transactionId: 519 }))
  })
})

describe('ExecutePendingTransactions — replay of pre-v3 histories', () => {
  it('runs the previous body: lists all pending rows and awaits each child with executeChild', async () => {
    mockPatched.mockReturnValue(false)
    activityMocks.listTransactions.mockResolvedValue([{ id: 519, createdAt: CREATED }])
    mockExecuteChild.mockResolvedValue({})

    await ExecutePendingTransactions({})

    expect(activityMocks.listDispatchableTransactions).not.toHaveBeenCalled()
    expect(mockStartChild).not.toHaveBeenCalled()
    expect(mockExecuteChild).toHaveBeenCalledWith('ExecuteTransaction', expect.objectContaining({ workflowId: `ExecuteTransaction-519-${CREATED}` }))
  })
})
