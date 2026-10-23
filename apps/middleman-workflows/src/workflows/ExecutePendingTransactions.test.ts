// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the workflow under test
// ---------------------------------------------------------------------------

const activityMocks = {
  listTransactions: jest.fn(),
  listDispatchableTransactions: jest.fn(),
  getBlockHeight: jest.fn(),
  recordDispatchAttempt: jest.fn(),
  claimUnbroadcastFailure: jest.fn(),
  claimUnbroadcastFailureWithEffects: jest.fn(),
  listFailureEffects: jest.fn(),
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
// Mocked by marker id. `outboxMarker` answers the failure-outbox marker; the v3 tests above the
// 'failure outbox' block run the pre-outbox v3 body, and that block flips it.
const OUTBOX_MARKER = 'execute-pending-failure-outbox'
let outboxMarker = false
const byMarker = (id: string) => (id === OUTBOX_MARKER ? outboxMarker : true)
const mockPatched = jest.fn(byMarker)
const mockStartChild = jest.fn()
const mockExecuteChild = jest.fn()
// The effects proxy is the one built from GIVE_UP_EFFECTS_OPTIONS.
const mockProxyActivities = jest.fn((options: unknown) =>
  options === GIVE_UP_EFFECTS_OPTIONS ? effectMocks : activityMocks)

jest.mock('@temporalio/workflow', () => {
  class MockActivityFailure extends Error {
    constructor(message: string, public cause?: Error) {
      super(message)
    }
  }
  class MockCancelledFailure extends Error {}
  return {
  proxyActivities: (options: unknown) => mockProxyActivities(options),
  startChild: (...args: unknown[]) => mockStartChild(...args),
  executeChild: (...args: unknown[]) => mockExecuteChild(...args),
  patched: (id: string) => mockPatched(id),
  WorkflowIdReusePolicy: { ALLOW_DUPLICATE_FAILED_ONLY: 'ALLOW_DUPLICATE_FAILED_ONLY', ALLOW_DUPLICATE: 'ALLOW_DUPLICATE' },
  ParentClosePolicy: { ABANDON: 'ABANDON' },
  ApplicationFailure: class MockApplicationFailure extends Error {},
  ActivityFailure: MockActivityFailure,
  CancelledFailure: MockCancelledFailure,
  // Same predicate as the SDK's (lib/errors.js in @temporalio/workflow 1.11.7).
  isCancellation: (err: unknown) => err instanceof MockCancelledFailure
    || (err instanceof MockActivityFailure && err.cause instanceof MockCancelledFailure),
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }
})
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
  FAILURE_EFFECTS_WARN_ROWS,
  GIVE_UP_EFFECTS_OPTIONS,
  GIVE_UP_LOG,
  GIVE_UP_MIN_AGE_MS,
  GIVE_UP_MIN_ATTEMPTS,
} from './ExecutePendingTransactions'
import { TransactionType } from '@igniter/db/middleman/enums'
import { ActivityFailure, CancelledFailure, log } from '@temporalio/workflow'

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
  outboxMarker = false
  mockPatched.mockImplementation(byMarker)
  activityMocks.listFailureEffects.mockResolvedValue([])
  activityMocks.claimUnbroadcastFailureWithEffects.mockResolvedValue(true)
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

describe('ExecutePendingTransactions v3 — failure outbox (execute-pending-failure-outbox marker set)', () => {
  const effectsStarts = () => mockStartChild.mock.calls.filter(([type]) => type === 'TransactionFailureEffects')
  const txStarts = () => mockStartChild.mock.calls.filter(([type]) => type === 'ExecuteTransaction')

  beforeEach(() => {
    outboxMarker = true
  })

  it('evaluates the marker once per run', async () => {
    await ExecutePendingTransactions({})

    expect(mockPatched.mock.calls.filter(([id]) => id === OUTBOX_MARKER)).toHaveLength(1)
  })

  it('give-up: claims with effects and the same triage log, runs no effect inline', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])

    await ExecutePendingTransactions({})

    expect(activityMocks.claimUnbroadcastFailureWithEffects).toHaveBeenCalledWith(519, GIVE_UP_LOG)
    expect(activityMocks.claimUnbroadcastFailure).not.toHaveBeenCalled()
    expect(effectMocks.getTransaction).not.toHaveBeenCalled()
    expect(effectMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(effectMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(txStarts()).toHaveLength(0)
  })

  it('starts one TransactionFailureEffects child per owed row, with the agreed options', async () => {
    activityMocks.listFailureEffects.mockResolvedValue([{ id: 7, failureEffects: 'pending' }, { id: 8, failureEffects: 'releasing' }])

    await ExecutePendingTransactions({})

    expect(effectsStarts()).toEqual([
      ['TransactionFailureEffects', {
        workflowId: 'TransactionFailureEffects-7',
        args: [{ transactionId: 7 }],
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        parentClosePolicy: 'ABANDON',
        workflowExecutionTimeout: '25h',
      }],
      ['TransactionFailureEffects', expect.objectContaining({ workflowId: 'TransactionFailureEffects-8', args: [{ transactionId: 8 }] })],
    ])
  })

  it('lists and starts effects before the early return: a tick with nothing to dispatch still drives them', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([])
    activityMocks.listFailureEffects.mockResolvedValue([{ id: 7, failureEffects: 'pending' }])

    await ExecutePendingTransactions({})

    expect(effectsStarts()).toHaveLength(1)
    expect(activityMocks.getBlockHeight).not.toHaveBeenCalled()
  })

  it('a run still open is skipped and counted; any other start error is logged with the tx id and is not fatal', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([])
    activityMocks.listFailureEffects.mockResolvedValue([{ id: 7, failureEffects: 'pending' }, { id: 8, failureEffects: 'pending' }])
    mockStartChild.mockRejectedValueOnce(alreadyStarted()).mockRejectedValueOnce(new Error('temporal unavailable'))

    await expect(ExecutePendingTransactions({})).resolves.toBeUndefined()

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TransactionFailureEffects'), expect.objectContaining({ transactionId: 8 }))
    expect(log.warn).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ transactionId: 7 }))
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('failure effects'), { listed: 2, started: 0, alreadyOpen: 1 })
  })

  it('effects starts are kept out of the fatal check, both ways', async () => {
    activityMocks.listFailureEffects.mockResolvedValue([{ id: 7, failureEffects: 'pending' }])
    activityMocks.listDispatchableTransactions.mockResolvedValue([row()])

    // Effects start fine, every ExecuteTransaction start fails: still fatal.
    mockStartChild.mockImplementation(async (type: string) => {
      if (type === 'ExecuteTransaction') throw new Error('temporal unavailable')
      return { firstExecutionRunId: 'fx' }
    })
    await expect(ExecutePendingTransactions({})).rejects.toThrow('no child workflow could be started')

    // Effects starts fail, the ExecuteTransaction start works: not fatal.
    mockStartChild.mockImplementation(async (type: string) => {
      if (type === 'TransactionFailureEffects') throw new Error('temporal unavailable')
      return { firstExecutionRunId: 'run-1' }
    })
    await expect(ExecutePendingTransactions({})).resolves.toBeUndefined()
  })

  it('warns above the row threshold', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([])
    activityMocks.listFailureEffects.mockResolvedValue(
      Array.from({ length: FAILURE_EFFECTS_WARN_ROWS + 1 }, (_, i) => ({ id: i + 1, failureEffects: 'pending' })),
    )

    await ExecutePendingTransactions({})

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('piling up'), expect.objectContaining({ listed: FAILURE_EFFECTS_WARN_ROWS + 1 }))
  })

  it('issues every effects start at once, not behind a concurrency limit', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([])
    const n = 25
    activityMocks.listFailureEffects.mockResolvedValue(Array.from({ length: n }, (_, i) => ({ id: i + 1, failureEffects: 'pending' })))
    // No start resolves until all n were issued: a limit below n would leave this waiting forever.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockStartChild.mockImplementation(async () => {
      if (mockStartChild.mock.calls.length === n) release()
      await gate
      return { firstExecutionRunId: 'fx' }
    })

    await ExecutePendingTransactions({})

    expect(effectsStarts()).toHaveLength(n)
  })

  it('a listing that failed for good is logged and dispatch goes on', async () => {
    activityMocks.listFailureEffects.mockRejectedValue(
      new (ActivityFailure as unknown as new (m: string, c: Error) => Error)('activity failed', new Error('db down')),
    )

    await expect(ExecutePendingTransactions({})).resolves.toBeUndefined()

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not list failure effects'), expect.objectContaining({ cause: 'db down' }))
    expect(effectsStarts()).toHaveLength(0)
    expect(txStarts()).toHaveLength(1)
  })

  it('a cancelled listing propagates: nothing dispatched', async () => {
    const cancelled = new (ActivityFailure as unknown as new (m: string, c: Error) => Error)(
      'Activity cancelled',
      new (CancelledFailure as unknown as new (m: string) => Error)('cancelled'),
    )
    activityMocks.listFailureEffects.mockRejectedValue(cancelled)

    await expect(ExecutePendingTransactions({})).rejects.toBe(cancelled)
    expect(txStarts()).toHaveLength(0)
  })

  it('a listing error that is not an ActivityFailure (a bug) propagates: nothing dispatched', async () => {
    const bug = new TypeError('bug in workflow code')
    activityMocks.listFailureEffects.mockRejectedValue(bug)

    await expect(ExecutePendingTransactions({})).rejects.toBe(bug)
    expect(txStarts()).toHaveLength(0)
  })

  it('neither threshold reached: no warning', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([])
    activityMocks.listFailureEffects.mockResolvedValue([{ id: 7, failureEffects: 'pending' }])

    await ExecutePendingTransactions({})

    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('ExecutePendingTransactions v3 — pre-outbox histories (marker unset)', () => {
  it('lists no failure effects, starts no effects child, and gives up with the old log and inline effects', async () => {
    activityMocks.listDispatchableTransactions.mockResolvedValue([row(STUCK)])

    await ExecutePendingTransactions({})

    expect(activityMocks.listFailureEffects).not.toHaveBeenCalled()
    expect(activityMocks.claimUnbroadcastFailure).toHaveBeenCalledWith(519, GIVE_UP_LOG)
    expect(activityMocks.claimUnbroadcastFailureWithEffects).not.toHaveBeenCalled()
    expect(effectMocks.notifyUserOfFailedTransaction).toHaveBeenCalled()
  })
})
