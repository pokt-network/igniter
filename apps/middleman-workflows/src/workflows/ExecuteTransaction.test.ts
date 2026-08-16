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

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => activityMocks,
  patched: (...args: unknown[]) => mockPatched(...(args as [])),
  ApplicationFailure: class extends Error {},
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { ExecuteTransaction } from './ExecuteTransaction'
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'

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

  it('RPC unreachable: keeps the anchor and lets the verifier settle it', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: false, neverSent: true, attempt: 1, message: 'RPC unreachable',
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    // The anchor must NOT be rolled back: clearing a hash for a tx that might be in a mempool
    // would hide it from the verifier, which is #339 itself. Unknown outcome → verifier owns it.
    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ log: 'RPC unreachable' }))
    expect(out.hash).toBe(LOCAL_HASH)
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

  it('timeout: stays pending, records the reason, notifies nobody', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: false, attempt: 1, isTimeout: true, message: 'RPC timeout',
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    // Diagnostics only, through the pending-guarded write — never a status change.
    expect(activityMocks.recordBroadcastDiagnostics).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ log: 'RPC timeout' }))
    expect(activityMocks.updateTransaction).not.toHaveBeenCalled()
    expect(activityMocks.claimBroadcastFailure).not.toHaveBeenCalled()
    expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
    expect(activityMocks.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(out.hash).toBe(LOCAL_HASH)
  })

  it('transport failure (no rejection flag): stays pending with the anchored hash', async () => {
    activityMocks.executeTransaction.mockResolvedValue({
      transactionHash: LOCAL_HASH, success: false, rejected: false, attempt: 1, message: 'socket hang up',
    })

    const out = await ExecuteTransaction({ transactionId: TX_ID })

    expect(activityMocks.persistBroadcastAnchor).toHaveBeenCalledWith(TX_ID, BROADCAST_HEIGHT)
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

    it('inherits the fix: a transport failure now carries a hash, so it is not marked Failure', async () => {
      activityMocks.getTxTimeoutHeight.mockResolvedValue(null)
      activityMocks.executeTransaction.mockResolvedValue({
        transactionHash: LOCAL_HASH, success: false, rejected: false, attempt: 1, message: 'socket hang up',
      })

      await ExecuteTransaction({ transactionId: TX_ID })

      const written = activityMocks.updateTransaction.mock.calls.map((c) => c[1])
      expect(written.every((payload) => !('status' in payload))).toBe(true)
      expect(activityMocks.notifyUserOfFailedTransaction).not.toHaveBeenCalled()
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
