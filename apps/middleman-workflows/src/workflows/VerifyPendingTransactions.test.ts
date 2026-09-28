import { TxRaw, TxBody, AuthInfo } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import type { PocketBlockchain } from '@igniter/pocket'
import type { VerificationDecision } from '@igniter/tx-verify'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import { delegatorActivities } from '@/activities'

// ---------------------------------------------------------------------------
// Regression for tx 459 (mainnet, 2026-09-28): an UNORDERED Stake of 90 suppliers was marked
// `failure` 14s after broadcast, before it landed in block 941750. Middleman read the tx as
// ordered: its sequence 0 is "consumed" by an account at sequence 9 forever, so the sequence
// bound fired on the first sweep. The values below are the ones that sweep recorded
// (.local/tx459/verify-1650.json): coverage 941749 at chain time 16:48:31.536Z, all operators
// absent, and the tx's own timeout_timestamp 16:56:12.779Z.
//
// The workflow runs as a plain async function (no @temporalio/testing here, see
// ExecuteTransaction.test.ts) with the REAL checkTxValidityEvidence, so the payload parse, the
// evidence and the workflow's wiring into decideVerification are all exercised. Every activity
// argument and result is JSON round-tripped, as Temporal's payload converter does: Dates cross
// the boundary as ISO strings.
// ---------------------------------------------------------------------------

const TX_ID = 459
const EXECUTION_HEIGHT = 941749
const SIGNER = 'pokt1mvl6n9ns6aftt4jnd4r3ql9lyl0dy6euh6pmse'
const TIMEOUT_TIMESTAMP = new Date('2026-09-28T16:56:12.779Z')
const CHAIN_TIME_AT_FIRST_SWEEP = new Date('2026-09-28T16:48:31.536Z')
const OPERATORS = ['pokt1u5tqp29397xm29zra4vjvxu6w8n2js8ulgqfq4', 'pokt1ymhtmzx0qgzyd2wr87e5k75ylcxylxwntsdu7w']

let mockActivities: Record<string, (...args: any[]) => Promise<unknown>> = {}

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => mockActivities[name]!(...args) }),
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  ApplicationFailure: class MockApplicationFailure extends Error {},
}))
jest.mock('@temporalio/activity', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  Context: { current: () => { throw new Error('Activity context not available') } },
}))
jest.mock('p-limit', () => () => (fn: () => Promise<unknown>) => fn())

// eslint-disable-next-line import/first
import { VerifyPendingTransactions } from './VerifyPendingTransactions'

function signedPayloadHex(body: { unordered: boolean; timeoutTimestamp?: Date }, sequence: number): string {
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages: [], ...body })).finish()
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({ signerInfos: [{ sequence }] })).finish()
  const txRawBytes = TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array([1, 2, 3])] })).finish()
  return Buffer.from(txRawBytes).toString('hex')
}

const roundTrip = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/**
 * One sweep over tx 459 with the hash absent at `coveredBlockTime` (undefined = the scan was caught
 * up to the head and fetched no block); returns the applied decision. `evidence` replaces the real
 * checkTxValidityEvidence, to stand in for a worker running another build.
 */
async function sweep(signedPayload: string, coveredBlockTime: Date | undefined, evidence?: unknown): Promise<{ decision: VerificationDecision; isSequenceConsumed: jest.Mock }> {
  // The signer's account is at sequence 9 (ordered txs 0–8): ANY tx sequence below it reads consumed.
  const isSequenceConsumed = jest.fn().mockResolvedValue({ consumed: true, observedAtHeight: EXECUTION_HEIGHT })
  const dal = {
    transaction: {
      getTransaction: jest.fn().mockResolvedValue({
        id: TX_ID,
        type: 'Stake',
        signedPayload,
        unsignedPayload: JSON.stringify({ body: { messages: [{ value: { signer: SIGNER } }] } }),
      }),
    },
  } as unknown as DAL
  const real = delegatorActivities(dal, { isSequenceConsumed } as unknown as PocketBlockchain, {} as ProviderService)

  let decision: VerificationDecision | undefined
  const stubs: Record<string, (...args: any[]) => Promise<unknown>> = {
    listPendingWithHash: async () => [{ id: TX_ID, executionHeight: EXECUTION_HEIGHT }],
    verifyTxHash: async () => ({ status: 'absent', coveredUpToHeight: EXECUTION_HEIGHT, coveredBlockTime }),
    verifySupplierEffect: async () => ({ status: 'absent', absentOperators: OPERATORS }),
    checkTxValidityEvidence: evidence === undefined ? real.checkTxValidityEvidence : async () => evidence,
    applyVerificationDecision: async (_id: number, d: VerificationDecision) => { decision = d },
  }
  mockActivities = Object.fromEntries(Object.entries(stubs).map(([name, fn]) => [
    name,
    async (...args: unknown[]) => roundTrip(await fn(...(roundTrip(args) as unknown[]))),
  ]))

  await VerifyPendingTransactions()
  return { decision: decision!, isSequenceConsumed }
}

describe('VerifyPendingTransactions — unordered txs (tx 459)', () => {
  const unordered = signedPayloadHex({ unordered: true, timeoutTimestamp: TIMEOUT_TIMESTAMP }, 0)

  it('stays pending while chain time has not passed timeout_timestamp, and never asks for the sequence', async () => {
    const { decision, isSequenceConsumed } = await sweep(unordered, CHAIN_TIME_AT_FIRST_SWEEP)

    expect(decision).toEqual({ tx: 'pending', effects: 'none', newLastCoveredHeight: EXECUTION_HEIGHT, incUnavailable: false })
    expect(isSequenceConsumed).not.toHaveBeenCalled()
  })

  it('stays pending at exactly timeout_timestamp (the tx is still valid in that block)', async () => {
    const { decision } = await sweep(unordered, TIMEOUT_TIMESTAMP)

    expect(decision.tx).toBe('pending')
  })

  it('fails only once chain time passes timeout_timestamp with the hash and the suppliers still absent', async () => {
    const { decision } = await sweep(unordered, new Date(TIMEOUT_TIMESTAMP.getTime() + 1))

    expect(decision).toEqual({ tx: 'failure', effects: 'apply-failure', failedOperators: OPERATORS, incUnavailable: false })
  })

  it('stays pending when the scan was caught up and read no block time, even long after the timeout', async () => {
    const { decision, isSequenceConsumed } = await sweep(unordered, undefined)

    expect(decision.tx).toBe('pending')
    expect(isSequenceConsumed).not.toHaveBeenCalled()
  })

  it('stays pending when a worker on the pre-unordered build answers the evidence (rolling deploy)', async () => {
    // Exactly what the old build returned for tx 459: no timestamp key, sequence "consumed".
    const oldBuildEvidence = { txTimeoutHeight: null, sequence: { consumed: true, observedAtHeight: EXECUTION_HEIGHT } }

    const { decision } = await sweep(unordered, CHAIN_TIME_AT_FIRST_SWEEP, oldBuildEvidence)

    expect(decision.tx).toBe('pending')
  })
})

describe('VerifyPendingTransactions — ordered txs keep the sequence bound', () => {
  it('an ordered tx whose sequence the account already consumed still fails on the first sweep', async () => {
    const ordered = signedPayloadHex({ unordered: false }, 0)

    const { decision, isSequenceConsumed } = await sweep(ordered, CHAIN_TIME_AT_FIRST_SWEEP)

    expect(isSequenceConsumed).toHaveBeenCalledWith(SIGNER, 0)
    expect(decision).toEqual({ tx: 'failure', effects: 'apply-failure', failedOperators: OPERATORS, incUnavailable: false })
  })

  it('an ordered tx that also embeds a timeout_timestamp keeps the sequence bound (it is not treated as unordered)', async () => {
    const ordered = signedPayloadHex({ unordered: false, timeoutTimestamp: TIMEOUT_TIMESTAMP }, 0)

    const { decision, isSequenceConsumed } = await sweep(ordered, CHAIN_TIME_AT_FIRST_SWEEP)

    expect(isSequenceConsumed).toHaveBeenCalledWith(SIGNER, 0)
    expect(decision.tx).toBe('failure')
  })
})
