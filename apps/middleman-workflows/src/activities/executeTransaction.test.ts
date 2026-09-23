import { delegatorActivities } from './index'
import { BROADCAST_OUTCOME_UNKNOWN } from '@/lib/broadcastOutcome'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import type { PocketBlockchain, SendTransactionResult } from '@igniter/pocket'
import { deriveTxHash } from '@igniter/pocket'
import { TxRaw, TxBody, AuthInfo } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import { ApplicationFailure } from '@temporalio/common'

// `null` = behave as if there is no activity context (Context.current() throws), which is what
// the activity sees under plain jest and must never mistake for "attempt 1".
const mockAttempt = jest.fn<number | null, []>()

jest.mock('@temporalio/activity', () => {
  const { ApplicationFailure: RealApplicationFailure } = jest.requireActual('@temporalio/common')
  return {
    ApplicationFailure: RealApplicationFailure,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    heartbeat: jest.fn(),
    sleep: jest.fn(),
    Context: {
      current: () => {
        const attempt = mockAttempt()
        if (attempt === null) throw new Error('Activity context not available')
        return { info: { attempt } }
      },
    },
  }
})

const TX_ID = 42
const SIGNED_PAYLOAD = 'deadbeef'.repeat(8)
const LOCAL_HASH = deriveTxHash(SIGNED_PAYLOAD)

/** A real TxRaw, hex-encoded the way middleman stores it, so the anchor parses real bytes. */
function buildSignedPayloadHex({ sequence, timeoutHeight }: { sequence: number; timeoutHeight: number }): string {
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages: [], timeoutHeight })).finish()
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({ signerInfos: [{ sequence }] })).finish()
  const txRawBytes = TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array([1, 2, 3])] })).finish()
  return Buffer.from(txRawBytes).toString('hex')
}

function makeActivities(transaction: Record<string, unknown> | null, sendResult?: SendTransactionResult) {
  const sendTransaction = jest.fn().mockResolvedValue(sendResult)
  const updateTransaction = jest.fn().mockResolvedValue(undefined)
  const recordPendingDiagnostics = jest.fn().mockResolvedValue(undefined)
  const dal = {
    transaction: {
      getTransaction: jest.fn().mockResolvedValue(transaction),
      updateTransaction,
      recordPendingDiagnostics,
    },
  } as unknown as DAL
  const rpc = { sendTransaction } as unknown as PocketBlockchain
  return {
    activities: delegatorActivities(dal, rpc, {} as ProviderService),
    sendTransaction,
    updateTransaction,
    recordPendingDiagnostics,
  }
}

const pendingTx = { id: TX_ID, type: 'Stake', signedPayload: SIGNED_PAYLOAD }

beforeEach(() => {
  jest.clearAllMocks()
  mockAttempt.mockReturnValue(1)
})

describe('executeTransaction', () => {
  it('success: returns the result with the attempt number from the activity context', async () => {
    mockAttempt.mockReturnValue(1)
    const { activities } = makeActivities(pendingTx, { transactionHash: LOCAL_HASH, success: true, rejected: false })

    await expect(activities.executeTransaction(TX_ID)).resolves.toEqual(
      expect.objectContaining({ success: true, rejected: false, transactionHash: LOCAL_HASH, attempt: 1 }),
    )
  })

  it('hard CheckTx rejection: RETURNS it (never throws), tagged with the attempt', async () => {
    // A rejection is definitive information the workflow must weigh against the attempt number;
    // retrying it would re-send bytes the node already refused.
    mockAttempt.mockReturnValue(2)
    const { activities, sendTransaction } = makeActivities(pendingTx, {
      transactionHash: LOCAL_HASH, success: false, rejected: true, code: 11, message: 'out of gas',
    })

    await expect(activities.executeTransaction(TX_ID)).resolves.toEqual(
      expect.objectContaining({ rejected: true, code: 11, attempt: 2 }),
    )
    expect(sendTransaction).toHaveBeenCalledTimes(1)
  })

  // The core of the reviewer's gap: a Soothe-signed tx carries no timeoutHeight, so a broadcast
  // that never reached a mempool would sit pending until the signer's sequence is consumed by
  // some OTHER tx. The activity must therefore hand unknown outcomes back to Temporal as a
  // retryable failure, so the same bytes are re-sent instead of the row being frozen.
  describe('unknown outcome → retryable ApplicationFailure', () => {
    it.each([
      ['node unreachable (neverSent)', { transactionHash: LOCAL_HASH, success: false, rejected: false, neverSent: true, message: 'connect ECONNREFUSED' }, true],
      ['connection dropped mid-request', { transactionHash: LOCAL_HASH, success: false, rejected: false, message: 'socket hang up' }, false],
      ['indeterminate CheckTx (mempool full)', { transactionHash: LOCAL_HASH, success: false, rejected: false, code: 20, codespace: 'sdk', message: 'mempool is full' }, false],
      ['legacy shape with neither flag', { transactionHash: LOCAL_HASH, success: false }, false],
    ] as Array<[string, SendTransactionResult, boolean]>)('%s', async (_label, sendResult, neverSent) => {
      const { activities } = makeActivities(pendingTx, sendResult)

      const thrown = await activities.executeTransaction(TX_ID).then(
        () => { throw new Error('expected executeTransaction to throw') },
        (error: unknown) => error,
      )

      expect(thrown).toBeInstanceOf(ApplicationFailure)
      const failure = thrown as ApplicationFailure
      expect(failure.type).toBe(BROADCAST_OUTCOME_UNKNOWN)
      // Retryable is the whole point: Temporal re-runs the activity, i.e. re-broadcasts.
      expect(failure.nonRetryable).toBe(false)
      expect(failure.details?.[0]).toEqual(expect.objectContaining({
        hash: LOCAL_HASH,
        neverSent,
        code: sendResult.code,
        message: sendResult.message,
      }))
    })
  })

  it('sdk code 32 (sequence mismatch) is RETURNED, not retried: a re-send cannot change a consumed sequence', async () => {
    mockAttempt.mockReturnValue(2)
    const { activities, sendTransaction } = makeActivities(pendingTx, {
      transactionHash: LOCAL_HASH, success: false, rejected: false, code: 32, codespace: 'sdk', message: 'account sequence mismatch',
    })

    await expect(activities.executeTransaction(TX_ID)).resolves.toEqual(
      expect.objectContaining({ success: false, rejected: false, code: 32, attempt: 2 }),
    )
    expect(sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('code 32 in a NON-sdk codespace is not the sequence rule and still retries', async () => {
    const { activities } = makeActivities(pendingTx, {
      transactionHash: LOCAL_HASH, success: false, rejected: false, code: 32, codespace: 'supplier', message: 'module error 32',
    })

    await expect(activities.executeTransaction(TX_ID)).rejects.toMatchObject({ type: BROADCAST_OUTCOME_UNKNOWN })
  })

  it('outside an activity context the attempt is null, so a rejection can never read as attempt 1', async () => {
    mockAttempt.mockReturnValue(null)
    const { activities } = makeActivities(pendingTx, {
      transactionHash: LOCAL_HASH, success: false, rejected: true, code: 11, message: 'out of gas',
    })

    const result = await activities.executeTransaction(TX_ID)

    expect(result.attempt).toBeNull()
  })

  // Deterministic guards must fail the run at once: under the broadcast retry policy a plain
  // Error would be retried five times over a minute of backoff for a row that cannot change.
  it('an unsigned row is a non-retryable failure and broadcasts nothing', async () => {
    const { activities, sendTransaction } = makeActivities({ ...pendingTx, signedPayload: null })

    await expect(activities.executeTransaction(TX_ID)).rejects.toMatchObject({
      message: 'Transaction is not signed',
      type: 'transaction_not_signed',
      nonRetryable: true,
    })
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('a missing row is a non-retryable failure and broadcasts nothing', async () => {
    const { activities, sendTransaction } = makeActivities(null)

    await expect(activities.executeTransaction(TX_ID)).rejects.toMatchObject({
      message: 'Transaction not found',
      type: 'transaction_not_found',
      nonRetryable: true,
    })
    expect(sendTransaction).not.toHaveBeenCalled()
  })
})

describe('persistBroadcastAnchor', () => {
  it('writes the locally derived hash, the pre-broadcast height and the embedded timeoutHeight', async () => {
    const payload = buildSignedPayloadHex({ sequence: 7, timeoutHeight: 1030 })
    const { activities, updateTransaction } = makeActivities({ ...pendingTx, signedPayload: payload })

    await expect(activities.persistBroadcastAnchor(TX_ID, 1000)).resolves.toBe(deriveTxHash(payload))

    expect(updateTransaction).toHaveBeenCalledWith(TX_ID, {
      hash: deriveTxHash(payload),
      executionHeight: 1000,
      timeoutHeight: 1030,
    })
  })

  it('a tx signed without a timeoutHeight (the Soothe path) anchors with timeoutHeight null', async () => {
    // This is the row shape that made the retry above necessary: the verifier has no height
    // bound to fail it on, so the anchor must not invent one.
    const payload = buildSignedPayloadHex({ sequence: 3, timeoutHeight: 0 })
    const { activities, updateTransaction } = makeActivities({ ...pendingTx, signedPayload: payload })

    await activities.persistBroadcastAnchor(TX_ID, 1000)

    expect(updateTransaction).toHaveBeenCalledWith(TX_ID, expect.objectContaining({ timeoutHeight: null }))
  })

  it('returns null and writes nothing for a payload that cannot be hashed', async () => {
    const { activities, updateTransaction } = makeActivities({ ...pendingTx, signedPayload: 'not-hex!!' })

    await expect(activities.persistBroadcastAnchor(TX_ID, 1000)).resolves.toBeNull()
    expect(updateTransaction).not.toHaveBeenCalled()
  })

  it('throws for a missing or unsigned row instead of anchoring garbage', async () => {
    const missing = makeActivities(null)
    await expect(missing.activities.persistBroadcastAnchor(TX_ID, 1000)).rejects.toThrow('Transaction not found')

    const unsigned = makeActivities({ ...pendingTx, signedPayload: null })
    await expect(unsigned.activities.persistBroadcastAnchor(TX_ID, 1000)).rejects.toThrow('Transaction is not signed')
  })
})

describe('recordBroadcastDiagnostics', () => {
  it('delegates to the pending-guarded DAL write with the fields as given', async () => {
    const { activities, recordPendingDiagnostics } = makeActivities(pendingTx)

    await activities.recordBroadcastDiagnostics(TX_ID, { code: 20, log: 'mempool is full' })

    expect(recordPendingDiagnostics).toHaveBeenCalledWith(TX_ID, { code: 20, log: 'mempool is full' })
  })
})
