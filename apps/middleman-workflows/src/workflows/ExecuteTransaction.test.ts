// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the workflow under test
// ---------------------------------------------------------------------------

const activityMocks = {
  getTransaction: jest.fn(),
  updateTransaction: jest.fn(),
  executeTransaction: jest.fn(),
  persistBroadcastAnchor: jest.fn(),
  // Only the legacy flow calls this; it stays until that branch is deleted.
  getTxTimeoutHeight: jest.fn(),
  claimBroadcastFailure: jest.fn(),
  recordBroadcastDiagnostics: jest.fn(),
  getBlockHeight: jest.fn(),
  notifyProviderOfFailedStakes: jest.fn(),
  notifyUserOfFailedTransaction: jest.fn(),
}

// There is no workflow test harness in this repo (@temporalio/testing is not a dependency —
// see noWorkflowError.test.ts), so the workflow is exercised as a plain async function with
// its activity proxy stubbed. That covers the branch logic, which is what #339 turns on; it
// does NOT cover determinism/replay semantics, which only the real SDK runtime can check.
// `patched()` decides which flow runs: true = post-#339 anchored flow (every new run),
// false = the legacy flow kept for histories recorded before the upgrade.
const mockPatched = jest.fn(() => true)
// Captures the options each proxyActivities() call was given, so the retry policy — the actual
// re-send mechanism — is asserted rather than silently discarded by the stub. The two proxies
// are told apart by their options: only the broadcast one carries `initialInterval`, and only
// it hands out the real `executeTransaction` mock. Reaching the broadcast through the default
// proxy (the committed code's shape) therefore throws, so the routing is pinned, not assumed.
const wrongProxy = jest.fn(() => {
  throw new Error('executeTransaction must be scheduled through the broadcast proxy')
})
const mockProxyActivities = jest.fn((options: unknown) => {
  const isBroadcastProxy = typeof options === 'object' && options !== null
    && 'initialInterval' in ((options as { retry?: Record<string, unknown> }).retry ?? {})
  return isBroadcastProxy
    ? { executeTransaction: activityMocks.executeTransaction }
    : { ...activityMocks, executeTransaction: wrongProxy }
})

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: unknown) => mockProxyActivities(options),
  patched: (...args: unknown[]) => mockPatched(...(args as [])),
  // Same shape the SDK gives the workflow: an ActivityFailure whose `cause` is the activity's
  // ApplicationFailure, carrying `type` and `details`. That is what `broadcastOutcomeUnknown`
  // matches on, so the mock must carry those fields, not just be an Error.
  ApplicationFailure: class MockApplicationFailure extends Error {
    constructor(message: string, public type?: string, public nonRetryable?: boolean, public details?: unknown[]) {
      super(message)
    }
  },
  ActivityFailure: class MockActivityFailure extends Error {
    constructor(message: string, public cause?: unknown) {
      super(message)
    }
  },
  TimeoutFailure: class MockTimeoutFailure extends Error {
    constructor(message: string, public cause?: unknown) {
      super(message)
    }
  },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { ExecuteTransaction } from './ExecuteTransaction'
import { ActivityFailure, ApplicationFailure, TimeoutFailure } from '@temporalio/workflow'
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import { BROADCAST_OUTCOME_UNKNOWN } from '@/lib/broadcastOutcome'

/** What Temporal hands the workflow once `executeTransaction` has thrown on every attempt. */
function retriesExhausted(detail: { message?: string; code?: number; neverSent?: boolean }) {
  const cause = new (ApplicationFailure as unknown as new (m: string, t: string, n: boolean, d: unknown[]) => Error)(
    detail.message ?? 'broadcast outcome unknown',
    BROADCAST_OUTCOME_UNKNOWN,
    false,
    [{ hash: 'ABCDEF01'.repeat(8), neverSent: detail.neverSent === true, code: detail.code, message: detail.message }],
  )
  return new (ActivityFailure as unknown as new (m: string, c: unknown) => Error)('Activity task failed', cause)
}

const TX_ID = 42
const LOCAL_HASH = 'ABCDEF01'.repeat(8)
const BROADCAST_HEIGHT = 1000

function pendingTx(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    status: TransactionStatus.Pending,
    type: TransactionType.Stake,
    hash: null,
    executionHeight: null,
    ...overrides,
  }
}

/** Order in which two jest mocks were first invoked. */
function calledBefore(first: jest.Mock, second: jest.Mock): boolean {
  return first.mock.invocationCallOrder[0]! < second.mock.invocationCallOrder[0]!
}

/**
 * #339: a broadcast that returns no clean answer is NOT proof of failure. Only a deterministic
 * CheckTx rejection is. Everything else must stay `pending` WITH a hash so the verifier's queue
 * (listPendingWithHash: pending + hash + executionHeight) can pick it up and settle it against
 * the chain.
 */
describe('ExecuteTransaction — broadcast outcome handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // clearAllMocks keeps implementations, so a test's mockRejectedValue on the broadcast would
    // leak into the next test; reset that one mock so every test states its own outcome.
    activityMocks.executeTransaction.mockReset()
    mockPatched.mockReturnValue(true)
    activityMocks.getTransaction.mockResolvedValue(pendingTx())
    activityMocks.getBlockHeight.mockResolvedValue(BROADCAST_HEIGHT)
    activityMocks.persistBroadcastAnchor.mockResolvedValue(LOCAL_HASH)
    activityMocks.claimBroadcastFailure.mockResolvedValue(true)
    activityMocks.recordBroadcastDiagnostics.mockResolvedValue(undefined)
    activityMocks.updateTransaction.mockResolvedValue(undefined)
    activityMocks.notifyProviderOfFailedStakes.mockResolvedValue(undefined)
    activityMocks.notifyUserOfFailedTransaction.mockResolvedValue(undefined)
  })

  // Unknown outcomes never come back as a result any more: the activity throws a retryable
  // failure so Temporal re-broadcasts the same bytes (the fix for a Soothe-signed tx, which has
  // no timeoutHeight for the verifier to fail it on). The workflow only sees the case where every
  // attempt ended that way, as an ActivityFailure wrapping the activity's ApplicationFailure.
  it('node unreachable on every attempt: keeps the anchor, records why, lets the verifier settle it', async () => {
    activityMocks.executeTransaction.mockRejectedValue(retriesExhausted({ message: 'connect ECONNREFUSED', neverSent: true }))

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    // The anchor must NOT be rolled back: clearing a hash for a tx that might be in a mempool
    // would hide it from the verifier, which is #339 itself. Unknown outcome → verifier owns it.
    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({
      log: expect.stringContaining('node unreachable on every broadcast attempt'),
    }))
    expect(out.hash).toBe(LOCAL_HASH)
    expect(out.status).toBe(TransactionStatus.Pending)
  })

  it('last attempt timed out (startToCloseTimeout): same as unknown — keeps the anchor, records it, defers', async () => {
    // A node that accepted the connection and never answered is the archetypal "may still land".
    // Temporal reports it as an ActivityFailure whose cause is a TimeoutFailure, not the
    // activity's own ApplicationFailure, so the catch must recognise both.
    const cause = new (TimeoutFailure as unknown as new (m: string) => Error)('Activity task timed out')
    activityMocks.executeTransaction.mockRejectedValue(
      new (ActivityFailure as unknown as new (m: string, c: unknown) => Error)('Activity task failed', cause),
    )

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({
      log: expect.stringContaining('broadcast attempt timed out'),
    }))
    expect(out.hash).toBe(LOCAL_HASH)
  })

  it('a timed-out last attempt keeps the previous attempt\'s answer in the diagnostics when it is ours', async () => {
    // Temporal hangs the prior attempt's failure off the TimeoutFailure; its code/neverSent are
    // the useful part of the story, so they must not be dropped for a generic "timed out".
    const previous = new (ApplicationFailure as unknown as new (m: string, t: string, n: boolean, d: unknown[]) => Error)(
      'mempool is full', BROADCAST_OUTCOME_UNKNOWN, false, [{ hash: LOCAL_HASH, code: 20, neverSent: false, message: 'mempool is full' }],
    )
    const timeout = new (TimeoutFailure as unknown as new (m: string, c: unknown) => Error)('Activity task timed out', previous)
    activityMocks.executeTransaction.mockRejectedValue(
      new (ActivityFailure as unknown as new (m: string, c: unknown) => Error)('Activity task failed', timeout),
    )

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({
      code: 20,
      log: expect.stringContaining('timed out; last answer: mempool is full'),
    }))
  })

  it('the broadcast activity gets the long backoff; every other activity keeps the short policy', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: true, rejected: false, attempt: 1,
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    const options = mockProxyActivities.mock.calls.map((c) => c[0] as { startToCloseTimeout: string; retry: Record<string, unknown> })
    expect(options).toHaveLength(2)
    expect(options).toContainEqual({ startToCloseTimeout: '30s', retry: { maximumAttempts: 3 } })
    expect(options).toContainEqual({
      startToCloseTimeout: '30s',
      retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '30s', maximumAttempts: 5 },
    })
    // And the broadcast actually went through the long-backoff proxy (see mockProxyActivities).
    expect(activityMocks.executeTransaction).toHaveBeenCalledWith(TX_ID)
    expect(wrongProxy).not.toHaveBeenCalled()
  })

  it('a non-Temporal error from the broadcast call propagates untouched (never mistaken for an unknown outcome)', async () => {
    // Only an ActivityFailure can mean "the activity ran and ended without an answer". Anything
    // else reaching this catch is a bug (or a test stub), and swallowing it as "unknown outcome"
    // would hide it behind a pending row.
    activityMocks.executeTransaction.mockRejectedValue(new Error('unexpected'))

    await expect(ExecuteTransaction({ transactionId: TX_ID })).rejects.toThrow('unexpected')
    expect(activityMocks.recordBroadcastDiagnostics).not.toHaveBeenCalled()
  })

  it('an activity failure that is NOT the broadcast-unknown signal propagates (the run must fail loudly)', async () => {
    const cause = new (ApplicationFailure as unknown as new (m: string, t: string) => Error)('boom', 'SomethingElse')
    activityMocks.executeTransaction.mockRejectedValue(
      new (ActivityFailure as unknown as new (m: string, c: unknown) => Error)('Activity task failed', cause),
    )

    await expect(ExecuteTransaction({ transactionId: TX_ID })).rejects.toThrow('Activity task failed')
    expect(activityMocks.recordBroadcastDiagnostics).not.toHaveBeenCalled()
  })

  it('a rejection with an UNKNOWN attempt number is deferred to the verifier, never terminalized', async () => {
    // `attempt: null` is what the activity reports outside a Temporal context. Attempt 1 is the
    // only value that may turn a rejection into a Failure, so unknown must fall on the safe side.
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: null, code: 11, message: 'out of gas',
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
  })

  it('rejection on a RETRY: does not terminalize — the earlier attempt may have landed the tx', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 2, code: 5, message: 'insufficient funds',
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    // Falls through to the unknown-outcome path, which only records diagnostics.
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ code: 5 }))
  })

  it('unhashable payload: terminal Failure instead of an infinite dispatch loop', async () => {
    activityMocks.persistBroadcastAnchor.mockResolvedValue(null)

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.executeTransaction).not.toHaveBeenCalled()
    expect(activityMocks.notifyProviderOfFailedStakes).toHaveBeenCalledWith(TX_ID)
    expect(activityMocks.updateTransaction).toHaveBeenCalledWith(TX_ID, expect.objectContaining({
      status: TransactionStatus.Failure,
    }))
    expect(out.status).toBe(TransactionStatus.Failure)
  })

  it('terminal failure goes through the CAS, never a blind write', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 1, code: 11, message: 'out of gas',
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    // updateTransaction would clobber a verdict the verifier may already have written.
    expect(activityMocks.claimBroadcastFailure).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ code: 11 }))
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
  })

  it('anchors hash + height BEFORE broadcasting, so a crash cannot re-broadcast', async () => {
    activityMocks.executeTransaction.mockResolvedValue({ transactionHash: LOCAL_HASH, success: true, rejected: false })

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.persistBroadcastAnchor).toHaveBeenCalledWith(TX_ID, BROADCAST_HEIGHT)
    expect(calledBefore(activityMocks.persistBroadcastAnchor, activityMocks.executeTransaction)).toBe(true)
  })

  it('rejected on the first attempt: Failure via CAS, user notified, addresses released', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 1, code: 11, message: 'out of gas',
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.claimBroadcastFailure).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ code: 11 }))
    expect(activityMocks.notifyUserOfFailedTransaction).toHaveBeenCalled()
    expect(activityMocks.notifyProviderOfFailedStakes).toHaveBeenCalledWith(TX_ID)
    expect(out.status).toBe(TransactionStatus.Failure)
  })

  it('rejected: claims the row BEFORE running any effect, since the verifier may disagree', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 1, code: 11, message: 'out of gas',
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(calledBefore(activityMocks.claimBroadcastFailure, activityMocks.notifyProviderOfFailedStakes)).toBe(true)
    expect(calledBefore(activityMocks.claimBroadcastFailure, activityMocks.notifyUserOfFailedTransaction)).toBe(true)
  })

  it('CAS lost (verifier settled first): releases nothing and notifies nobody', async () => {
    activityMocks.claimBroadcastFailure.mockResolvedValue(false)
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 1, code: 11, message: 'out of gas',
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    // The verifier can settle this row Success on goal-state alone (a sibling tx staked the same
    // operator). Releasing those addresses would contradict a verdict that stands, and telling
    // the user it failed would contradict it twice.
    expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(out.status).toBe(TransactionStatus.Pending)
  })

  it('rejected non-stake: does NOT call the stake-release hook', async () => {
    activityMocks.getTransaction.mockResolvedValue(pendingTx({ type: TransactionType.Unstake }))
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 1, code: 11, message: 'out of gas',
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).toHaveBeenCalled()
  })

  it('indeterminate CheckTx on every attempt: stays pending, records code + reason, notifies nobody', async () => {
    activityMocks.executeTransaction.mockRejectedValue(retriesExhausted({ message: 'mempool is full', code: 20 }))

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    // Diagnostics only, through the pending-guarded write — never a status change.
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ code: 20, log: 'mempool is full' }))
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(out.hash).toBe(LOCAL_HASH)
  })

  it('a RETURNED indeterminate result (sequence mismatch, code 32) stays pending with the anchored hash', async () => {
    // The one non-definitive answer the activity returns rather than retries: a re-send cannot
    // change a consumed sequence, so it goes straight to the verifier — keep the anchor, record
    // the reason, no status write.
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: false, attempt: 2, code: 32, codespace: 'sdk', message: 'account sequence mismatch',
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.persistBroadcastAnchor).toHaveBeenCalledWith(TX_ID, BROADCAST_HEIGHT)
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ code: 32, log: 'account sequence mismatch' }))
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(out.hash).toBe(LOCAL_HASH)
  })

  it('undefined rejected (legacy shape) is treated as not-rejected', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, message: 'unknown error',
    })

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
  })

  it('success: leaves the anchored row pending for the verifier, writes no status', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: true, rejected: false,
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
    expect(out.hash).toBe(LOCAL_HASH)
    expect(out.executionHeight).toBe(BROADCAST_HEIGHT)
  })

  it('already broadcast (hash present): returns early without anchoring or broadcasting', async () => {
    activityMocks.getTransaction.mockResolvedValue(pendingTx({ hash: LOCAL_HASH }))

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.persistBroadcastAnchor).not.toHaveBeenCalled()
    expect(activityMocks.executeTransaction).not.toHaveBeenCalled()
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
  })

  // Runs that were already open when the new version deployed replay this path. It must keep
  // working — and, because activities are never version-pinned, it inherits the fixed
  // sendTransaction and so no longer strands a transport failure.
  describe('legacy flow (pre-#339 histories, patched() === false)', () => {
    beforeEach(() => {
      mockPatched.mockReturnValue(false)
    })

    it('does not anchor, and persists the hash after broadcasting', async () => {
      activityMocks.getTxTimeoutHeight.mockResolvedValue(1030)
      activityMocks.executeTransaction.mockResolvedValue({
        transactionHash: LOCAL_HASH, success: true, rejected: false, attempt: 1,
      })

      const out = await ExecuteTransaction({ transactionId: TX_ID })

      expect(activityMocks.persistBroadcastAnchor).not.toHaveBeenCalled()
      expect(activityMocks.updateTransaction).toHaveBeenCalledWith(TX_ID, {
        executionHeight: BROADCAST_HEIGHT,
        hash: LOCAL_HASH,
        timeoutHeight: 1030,
      })
      expect(out.hash).toBe(LOCAL_HASH)
    })

    it('inherits the fix: a rejection on a retry still carries a hash, so it is not marked Failure', async () => {
      activityMocks.getTxTimeoutHeight.mockResolvedValue(null)
      activityMocks.executeTransaction.mockResolvedValue({
        transactionHash: LOCAL_HASH, success: false, rejected: true, attempt: 2, code: 32, message: 'account sequence mismatch',
      })

      await ExecuteTransaction({ transactionId: TX_ID })

      const written = activityMocks.updateTransaction.mock.calls.map((c) => c[1])
      expect(written.every((payload) => !('status' in payload))).toBe(true)
      expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    })

    it('an unknown outcome on every attempt anchors the row in THIS run and hands it to the verifier', async () => {
      // An earlier attempt may have landed the bytes (the upgrade kills in-flight activities).
      // Letting the run fail would relaunch it as a fresh run with no hash, which re-sends as
      // activity attempt 1 and could trust a CheckTx rejection while the stake is on-chain. So
      // the legacy branch anchors (hash derived from the signed bytes) and returns pending.
      activityMocks.executeTransaction.mockRejectedValue(retriesExhausted({ message: 'connect ECONNREFUSED', neverSent: true }))

      const out = await ExecuteTransaction({ transactionId: TX_ID })

      expect(activityMocks.persistBroadcastAnchor).toHaveBeenCalledWith(TX_ID, BROADCAST_HEIGHT)
      expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ log: 'connect ECONNREFUSED' }))
      // Anchor first: until the hash is written the verifier cannot see the row, and the
      // diagnostics write is pending-guarded on purpose. Swapping them would still pass the
      // assertions above, so the order is pinned here.
      expect(calledBefore(activityMocks.persistBroadcastAnchor, activityMocks.recordBroadcastDiagnostics)).toBe(true)
      expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
      expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
      expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
      expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
      expect(out.hash).toBe(LOCAL_HASH)
      expect(out.status).toBe(TransactionStatus.Pending)
    })

    it('an unknown outcome on a payload that cannot be anchored still fails the legacy run', async () => {
      // A null anchor means the signed bytes are not even hashable; there is nothing to hand to
      // the verifier, so the original failure must surface rather than a hashless pending row.
      activityMocks.persistBroadcastAnchor.mockResolvedValue(null)
      activityMocks.executeTransaction.mockRejectedValue(retriesExhausted({ message: 'connect ECONNREFUSED', neverSent: true }))

      await expect(ExecuteTransaction({ transactionId: TX_ID })).rejects.toThrow('Activity task failed')
      expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
    })

    it('a non-broadcast failure still fails the legacy run', async () => {
      const cause = new (ApplicationFailure as unknown as new (m: string, t: string) => Error)('boom', 'SomethingElse')
      activityMocks.executeTransaction.mockRejectedValue(
        new (ActivityFailure as unknown as new (m: string, c: unknown) => Error)('Activity task failed', cause),
      )

      await expect(ExecuteTransaction({ transactionId: TX_ID })).rejects.toThrow('Activity task failed')
      expect(activityMocks.persistBroadcastAnchor).not.toHaveBeenCalled()
    })
  })

  it('expired before broadcast: effects run before the status flip, and nothing is broadcast', async () => {
    activityMocks.getTransaction.mockResolvedValue(pendingTx({ executionHeight: 1 }))

    await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.executeTransaction).not.toHaveBeenCalled()
    expect(calledBefore(activityMocks.notifyProviderOfFailedStakes, activityMocks.updateTransaction)).toBe(true)
    expect(activityMocks.updateTransaction).toHaveBeenCalledWith(TX_ID, expect.objectContaining({
      status: TransactionStatus.Failure,
    }))
  })
})
