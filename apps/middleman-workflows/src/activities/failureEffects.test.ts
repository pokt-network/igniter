import { delegatorActivities } from './index'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import type { ReleaseOutcome } from '@/lib/provider/releaseOutcome'
import type { PocketBlockchain } from '@igniter/pocket'
import type { VerificationDecision } from '@igniter/tx-verify'
import { ApplicationFailure } from '@temporalio/common'
import { log } from '@temporalio/activity'
import { dispatchUserNotification } from '@/lib/notifications/dispatch'

jest.mock('@temporalio/activity', () => {
  const { ApplicationFailure: RealApplicationFailure } = jest.requireActual('@temporalio/common')
  return {
    ApplicationFailure: RealApplicationFailure,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    heartbeat: jest.fn(),
    sleep: jest.fn(),
    Context: { current: () => { throw new Error('Activity context not available') } },
  }
})

jest.mock('@/lib/notifications/dispatch', () => ({
  dispatchUserNotification: jest.fn().mockResolvedValue(undefined),
}))

const dispatchMock = dispatchUserNotification as jest.Mock
const logMock = log as unknown as Record<'info' | 'warn' | 'error', jest.Mock>

const TX_ID = 42
const PROVIDER = { id: 7, identity: 'prov-1', name: 'P', url: 'http://provider.test' }

/** unsignedPayload with one MsgStakeSupplier per operator, as the middleman stores it. */
function stakePayload(operators: string[]): string {
  return JSON.stringify({
    body: {
      messages: operators.map((operatorAddress) => ({
        typeUrl: '/pocket.supplier.MsgStakeSupplier',
        value: { operatorAddress, ownerAddress: 'pokt1owner', stake: { amount: '100' }, services: [] },
      })),
    },
  })
}

const stakeTx = {
  id: TX_ID,
  type: 'Stake',
  status: 'failure',
  hash: 'ABC',
  log: 'out of funds',
  createdBy: 'pokt1owner',
  providerId: PROVIDER.identity,
  unsignedPayload: stakePayload(['pokt1x', 'pokt1y']),
  failureEffects: 'pending',
  failureReleaseAddresses: null as string[] | null,
}

function makeHarness(transaction: Record<string, unknown> | undefined, opts: {
  outcome?: ReleaseOutcome
  beginRelease?: 'proceed' | 'was-releasing' | 'nothing'
  noReleaseOwed?: boolean
  provider?: Record<string, unknown> | undefined
} = {}) {
  const tx = {
    getTransaction: jest.fn().mockResolvedValue(transaction),
    recordVerificationProgress: jest.fn().mockResolvedValue(undefined),
    claimTerminalTransition: jest.fn().mockResolvedValue(transaction),
    claimVerifierFailureWithEffects: jest.fn().mockResolvedValue(transaction),
    claimUnbroadcastFailureWithEffects: jest.fn().mockResolvedValue(transaction),
    claimBroadcastFailureWithEffects: jest.fn().mockResolvedValue(transaction),
    beginRelease: jest.fn().mockResolvedValue(opts.beginRelease ?? 'proceed'),
    releaseNotSent: jest.fn().mockResolvedValue(true),
    releaseDone: jest.fn().mockResolvedValue(true),
    releaseManual: jest.fn().mockResolvedValue(true),
    noReleaseOwed: jest.fn().mockResolvedValue(opts.noReleaseOwed ?? true),
    effectsExhausted: jest.fn().mockResolvedValue(true),
    claimNotify: jest.fn().mockResolvedValue(transaction),
  }
  const provider = {
    getProvider: jest.fn().mockResolvedValue('provider' in opts ? opts.provider : PROVIDER),
  }
  const dal = { transaction: tx, provider } as unknown as DAL
  const rpc = { getHeight: jest.fn().mockResolvedValue(1000) } as unknown as PocketBlockchain
  const providerService = {
    releaseSuppliersOutcome: jest.fn().mockResolvedValue(opts.outcome ?? { kind: 'ok' }),
  }
  const activities = delegatorActivities(dal, rpc, providerService as unknown as ProviderService)
  const effects = {
    createNewNodesFromTransaction: jest.spyOn(activities, 'createNewNodesFromTransaction').mockResolvedValue([]),
    notifyProviderOfStakedAddresses: jest.spyOn(activities, 'notifyProviderOfStakedAddresses').mockResolvedValue(undefined as never),
    notifyProviderOfFailedStakes: jest.spyOn(activities, 'notifyProviderOfFailedStakes').mockResolvedValue(undefined as never),
    updateUnstakingNodesFromTransaction: jest.spyOn(activities, 'updateUnstakingNodesFromTransaction').mockResolvedValue([]),
    notifyProviderOfUntakingAddresses: jest.spyOn(activities, 'notifyProviderOfUntakingAddresses').mockResolvedValue(undefined as never),
  }
  return { activities, tx, provider, providerService, effects }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('claim*WithEffects', () => {
  it('claimUnbroadcastFailureWithEffects: true iff the DAL CAS returned the row', async () => {
    const won = makeHarness(stakeTx)
    await expect(won.activities.claimUnbroadcastFailureWithEffects(TX_ID, 'expired')).resolves.toBe(true)
    expect(won.tx.claimUnbroadcastFailureWithEffects).toHaveBeenCalledWith(TX_ID, 'expired')

    const lost = makeHarness(undefined)
    await expect(lost.activities.claimUnbroadcastFailureWithEffects(TX_ID, 'expired')).resolves.toBe(false)
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('CAS lost'), { transactionId: TX_ID })
  })

  it('claimBroadcastFailureWithEffects: true iff the DAL CAS returned the row', async () => {
    const fields = { code: 11, log: 'rejected' }
    const won = makeHarness(stakeTx)
    await expect(won.activities.claimBroadcastFailureWithEffects(TX_ID, fields)).resolves.toBe(true)
    expect(won.tx.claimBroadcastFailureWithEffects).toHaveBeenCalledWith(TX_ID, fields)
    expect(won.tx.claimTerminalTransition).not.toHaveBeenCalled()

    const lost = makeHarness(undefined)
    await expect(lost.activities.claimBroadcastFailureWithEffects(TX_ID, fields)).resolves.toBe(false)
  })
})

describe('applyVerificationDecisionWithEffects', () => {
  const applyFailure = (failedOperators: string[] | undefined): VerificationDecision => ({
    tx: 'failure', effects: 'apply-failure', failedOperators, code: 5, gasUsed: '1234', rawLog: 'insufficient funds', incUnavailable: false,
  })

  it('apply-failure on a Stake: outbox CAS with the failed operators, no release, no inline notify', async () => {
    const h = makeHarness(stakeTx)

    await h.activities.applyVerificationDecisionWithEffects(TX_ID, applyFailure(['pokt1x']))

    expect(h.tx.claimVerifierFailureWithEffects).toHaveBeenCalledWith(
      TX_ID,
      { verificationHeight: 1000, log: 'insufficient funds', code: 5, consumedFee: 1234 },
      ['pokt1x'],
    )
    expect(h.tx.claimTerminalTransition).not.toHaveBeenCalled()
    expect(h.effects.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('[] failed operators stay [] (never NULL, which would mean every staking supplier)', async () => {
    const h = makeHarness(stakeTx)

    await h.activities.applyVerificationDecisionWithEffects(TX_ID, applyFailure([]))

    const addresses = h.tx.claimVerifierFailureWithEffects.mock.calls[0][2]
    expect(addresses).toEqual([])
    expect(addresses).not.toBeNull()
  })

  it('writes the same fields the old activity writes for the same verdict', async () => {
    const decision = applyFailure(['pokt1x'])
    const oldH = makeHarness(stakeTx)
    await oldH.activities.applyVerificationDecision(TX_ID, decision)
    const newH = makeHarness(stakeTx)
    await newH.activities.applyVerificationDecisionWithEffects(TX_ID, decision)

    const [oldId, oldStatus, oldFields] = oldH.tx.claimTerminalTransition.mock.calls[0]
    expect(oldStatus).toBe('failure')
    expect(newH.tx.claimVerifierFailureWithEffects.mock.calls[0].slice(0, 2)).toEqual([oldId, oldFields])
    // The old one still releases inline and notifies.
    expect(oldH.effects.notifyProviderOfFailedStakes).toHaveBeenCalledWith(TX_ID, ['pokt1x'])
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  // Divergence: the new body re-implements the old apply-failure field build and its warn log. The old
  // body is the reference and stays untouched; this pins the copy to it, for both shapes of verdict.
  it.each<[string, VerificationDecision]>([
    ['chain rawLog, code and gas', applyFailure(['pokt1x'])],
    ['no rawLog, no code, no gas', { tx: 'failure', effects: 'apply-failure', failedOperators: ['pokt1x'], incUnavailable: false }],
    ['no failedOperators', applyFailure(undefined)],
  ])('apply-failure Stake (%s): new path writes the fields and the warn log the old path computes', async (_name, decision) => {
    const run = async (call: (h: ReturnType<typeof makeHarness>) => Promise<void>) => {
      jest.clearAllMocks()
      const h = makeHarness(stakeTx)
      await call(h)
      // Copied out now: the next run's clearAllMocks would empty these.
      return {
        terminal: [...h.tx.claimTerminalTransition.mock.calls],
        outbox: [...h.tx.claimVerifierFailureWithEffects.mock.calls],
        warn: logMock.warn.mock.calls.filter(([m]) => m === 'transaction verification failed'),
      }
    }
    const oldRun = await run((h) => h.activities.applyVerificationDecision(TX_ID, decision))
    const newRun = await run((h) => h.activities.applyVerificationDecisionWithEffects(TX_ID, decision))

    expect(oldRun.terminal).toHaveLength(1)
    const [oldId, oldStatus, oldFields] = oldRun.terminal[0]
    expect(oldStatus).toBe('failure')
    expect(newRun.outbox).toHaveLength(1)
    const [newId, newFields] = newRun.outbox[0]
    expect([newId, newFields]).toEqual([oldId, oldFields])
    expect(newRun.warn).toHaveLength(1)
    expect(newRun.warn).toEqual(oldRun.warn)
  })

  it('a lost CAS (already terminal, or a lost ack) runs nothing else and does not throw', async () => {
    const h = makeHarness(stakeTx)
    h.tx.claimVerifierFailureWithEffects.mockResolvedValue(undefined)

    await expect(h.activities.applyVerificationDecisionWithEffects(TX_ID, applyFailure(['pokt1x']))).resolves.toBeUndefined()
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(h.effects.notifyProviderOfFailedStakes).not.toHaveBeenCalled()
  })

  it('apply-failure without failedOperators (no stake message in the payload): stores [], warns with the tx id, does not throw', async () => {
    const h = makeHarness(stakeTx)

    await expect(h.activities.applyVerificationDecisionWithEffects(TX_ID, applyFailure(undefined))).resolves.toBeUndefined()

    expect(h.tx.claimVerifierFailureWithEffects).toHaveBeenCalledWith(TX_ID, expect.any(Object), [])
    expect(h.tx.claimTerminalTransition).not.toHaveBeenCalled()
    expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('failedOperators'), { transactionId: TX_ID })
  })

  // Every verdict other than apply-failure on a Stake: the new activity must make exactly the calls
  // the old one makes.
  const unchanged: Array<[string, Record<string, unknown>, VerificationDecision]> = [
    ['apply-success Stake', stakeTx, { tx: 'success', effects: 'apply-success', code: 0, gasUsed: '10', incUnavailable: false }],
    ['sibling met the goal (failure + apply-success)', stakeTx, { tx: 'failure', effects: 'apply-success', code: 5, rawLog: 'seq', incUnavailable: false }],
    ["effects 'none' failure on a Stake", stakeTx, { tx: 'failure', effects: 'none', incUnavailable: false }],
    ["effects 'none' success on Operational Funds", { ...stakeTx, type: 'Operational Funds' }, { tx: 'success', effects: 'none', incUnavailable: false }],
    ['apply-failure on an Upstake', { ...stakeTx, type: 'Upstake' }, { tx: 'failure', effects: 'apply-failure', failedOperators: ['pokt1x'], incUnavailable: false }],
    ['apply-success Unstake', { ...stakeTx, type: 'Unstake' }, { tx: 'success', effects: 'apply-success', incUnavailable: false }],
    ['pending', stakeTx, { tx: 'pending', effects: 'none', newLastCoveredHeight: 900, incUnavailable: false }],
  ]

  it.each(unchanged)('%s: same calls as applyVerificationDecision', async (_name, txn, decision) => {
    const record = async (run: (h: ReturnType<typeof makeHarness>) => Promise<void>) => {
      jest.clearAllMocks()
      const h = makeHarness(txn)
      await run(h)
      return {
        claimTerminalTransition: h.tx.claimTerminalTransition.mock.calls,
        claimVerifierFailureWithEffects: h.tx.claimVerifierFailureWithEffects.mock.calls,
        recordVerificationProgress: h.tx.recordVerificationProgress.mock.calls,
        effects: Object.fromEntries(Object.entries(h.effects).map(([k, m]) => [k, m.mock.calls])),
        dispatch: dispatchMock.mock.calls.map((c) => c[2]),
      }
    }

    const oldCalls = await record((h) => h.activities.applyVerificationDecision(TX_ID, decision))
    const newCalls = await record((h) => h.activities.applyVerificationDecisionWithEffects(TX_ID, decision))

    expect(newCalls).toEqual(oldCalls)
    expect(newCalls.claimVerifierFailureWithEffects).toEqual([])
  })
})

describe('releaseFailedStake', () => {
  it('pending + owed + 200: one POST of every staking supplier (addresses NULL), then done', async () => {
    const h = makeHarness(stakeTx)

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('released')

    expect(h.tx.noReleaseOwed).not.toHaveBeenCalled()
    expect(h.tx.beginRelease).toHaveBeenCalledWith(TX_ID)
    expect(h.providerService.releaseSuppliersOutcome).toHaveBeenCalledTimes(1)
    expect(h.providerService.releaseSuppliersOutcome).toHaveBeenCalledWith(['pokt1x', 'pokt1y'], PROVIDER)
    expect(h.tx.releaseDone).toHaveBeenCalledWith(TX_ID)
    expect(h.tx.releaseManual).not.toHaveBeenCalled()
    expect(logMock.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ transactionId: TX_ID, providerUrl: PROVIDER.url }))
  })

  it('non-NULL failureReleaseAddresses: POSTs exactly those, not every staking supplier', async () => {
    const h = makeHarness({ ...stakeTx, failureReleaseAddresses: ['pokt1y'] })

    await h.activities.releaseFailedStake(TX_ID)

    expect(h.providerService.releaseSuppliersOutcome).toHaveBeenCalledWith(['pokt1y'], PROVIDER)
  })

  it('[] failureReleaseAddresses: release nothing → noReleaseOwed, no POST, no entry CAS', async () => {
    const h = makeHarness({ ...stakeTx, failureReleaseAddresses: [] })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('no-release-owed')

    expect(h.tx.noReleaseOwed).toHaveBeenCalledWith(TX_ID)
    expect(h.tx.beginRelease).not.toHaveBeenCalled()
    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
    expect(logMock.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ providerUrl: PROVIDER.url, addresses: [] }))
  })

  it.each([
    ['not a Stake', { ...stakeTx, type: 'Upstake' }, PROVIDER],
    ['no providerId', { ...stakeTx, providerId: null }, PROVIDER],
    ['provider row not found', stakeTx, undefined],
    ['no staking supplier in the payload', { ...stakeTx, unsignedPayload: stakePayload([]) }, PROVIDER],
  ])('%s → noReleaseOwed, no POST', async (_name, txn, provider) => {
    const h = makeHarness(txn, { provider })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('no-release-owed')

    expect(h.tx.noReleaseOwed).toHaveBeenCalledWith(TX_ID)
    expect(h.tx.beginRelease).not.toHaveBeenCalled()
    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
  })

  it('nothing owed and the row is releasing: noReleaseOwed moves it to done, no POST, no entry CAS', async () => {
    const h = makeHarness({ ...stakeTx, type: 'Upstake', failureEffects: 'releasing' })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('no-release-owed')

    expect(h.tx.noReleaseOwed).toHaveBeenCalledWith(TX_ID)
    expect(h.tx.beginRelease).not.toHaveBeenCalled()
    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
  })

  it.each(['done', 'manual', null])('nothing owed and the row is %s: nothing moved, nothing, no entry CAS', async (state) => {
    const h = makeHarness({ ...stakeTx, type: 'Upstake', failureEffects: state }, { noReleaseOwed: false })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('nothing')

    expect(h.tx.beginRelease).not.toHaveBeenCalled()
    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('nothing to do'), expect.objectContaining({ transactionId: TX_ID, failureEffects: state }))
  })

  it('nothing owed but the noReleaseOwed CAS lost: logs the state re-read after the CAS, not the stale one', async () => {
    const h = makeHarness({ ...stakeTx, type: 'Upstake', failureEffects: 'pending' }, { noReleaseOwed: false })
    h.tx.getTransaction
      .mockResolvedValueOnce({ ...stakeTx, type: 'Upstake', failureEffects: 'pending' })
      .mockResolvedValueOnce({ ...stakeTx, type: 'Upstake', failureEffects: 'done' })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('nothing')

    expect(h.tx.getTransaction).toHaveBeenCalledTimes(2)
    expect(h.tx.beginRelease).not.toHaveBeenCalled()
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('nothing to do'), expect.objectContaining({ transactionId: TX_ID, failureEffects: 'done' }))
    expect(logMock.info).not.toHaveBeenCalledWith(expect.stringContaining('nothing to do'), expect.objectContaining({ failureEffects: 'pending' }))
  })

  it("entry 'releasing' (was-releasing): no POST, log.error with tx id, provider url and addresses", async () => {
    const h = makeHarness({ ...stakeTx, failureEffects: 'releasing' }, { beginRelease: 'was-releasing' })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('manual')

    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
    expect(h.tx.releaseDone).not.toHaveBeenCalled()
    expect(h.tx.releaseManual).not.toHaveBeenCalled()
    expect(logMock.error).toHaveBeenCalledWith(expect.any(String), {
      transactionId: TX_ID, providerUrl: PROVIDER.url, addresses: ['pokt1x', 'pokt1y'],
    })
  })

  it.each(['done', 'manual', null])("entry %s ('nothing'): no POST, no outcome CAS, logged", async (state) => {
    const h = makeHarness({ ...stakeTx, failureEffects: state }, { beginRelease: 'nothing' })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('nothing')

    expect(h.providerService.releaseSuppliersOutcome).not.toHaveBeenCalled()
    expect(h.tx.releaseDone).not.toHaveBeenCalled()
    expect(h.tx.releaseManual).not.toHaveBeenCalled()
    expect(h.tx.releaseNotSent).not.toHaveBeenCalled()
    expect(logMock.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      transactionId: TX_ID, failureEffects: state, providerUrl: PROVIDER.url,
    }))
  })

  it.each([
    ['ECONNREFUSED'],
    ['LOCAL_PRE_SEND'],
  ])('not-sent (%s): back to pending, then a RETRYABLE failure', async (code) => {
    const h = makeHarness(stakeTx, { outcome: { kind: 'not-sent', code } })

    const err = await h.activities.releaseFailedStake(TX_ID).catch((e) => e)

    expect(err).toBeInstanceOf(ApplicationFailure)
    expect(err.nonRetryable).toBe(false)
    expect(err.type).toBe('release_not_sent')
    expect(h.tx.releaseNotSent).toHaveBeenCalledWith(TX_ID)
    expect(h.tx.releaseNotSent.mock.invocationCallOrder[0])
      .toBeLessThan(Math.max(...logMock.warn.mock.invocationCallOrder))
    expect(h.tx.releaseDone).not.toHaveBeenCalled()
    expect(h.tx.releaseManual).not.toHaveBeenCalled()
    expect(logMock.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ transactionId: TX_ID, providerUrl: PROVIDER.url, code }))
  })

  it.each<[string, ReleaseOutcome]>([
    ['HTTP 500', { kind: 'ambiguous', status: 500, message: 'HTTP 500 Internal Server Error' }],
    ['timeout', { kind: 'ambiguous', message: 'TimeoutError: The operation was aborted due to timeout' }],
    ['socket error', { kind: 'ambiguous', code: 'ECONNRESET', message: 'TypeError: fetch failed' }],
  ])('ambiguous (%s): manual + log.error with tx id, provider url, addresses; never retried', async (_name, outcome) => {
    const h = makeHarness(stakeTx, { outcome })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('manual')

    expect(h.tx.releaseManual).toHaveBeenCalledWith(TX_ID)
    expect(h.tx.releaseNotSent).not.toHaveBeenCalled()
    expect(h.tx.releaseDone).not.toHaveBeenCalled()
    expect(logMock.error).toHaveBeenCalledWith(expect.any(String), {
      transactionId: TX_ID, providerUrl: PROVIDER.url, addresses: ['pokt1x', 'pokt1y'], outcome,
    })
  })

  describe('a lost outcome CAS (the row moved meanwhile) is honoured', () => {
    const moved = (h: ReturnType<typeof makeHarness>, now: string) => {
      h.tx.getTransaction.mockResolvedValueOnce(stakeTx).mockResolvedValueOnce({ ...stakeTx, failureEffects: now })
    }

    it('200 but releaseDone lost: never reports or logs released; warns with the state the row is in now', async () => {
      const h = makeHarness(stakeTx, { outcome: { kind: 'ok' } })
      h.tx.releaseDone.mockResolvedValue(false)
      moved(h, 'manual')

      await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('moved-meanwhile')

      expect(logMock.info).not.toHaveBeenCalledWith(expect.stringContaining('released'), expect.anything())
      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('row moved meanwhile'), expect.objectContaining({
        transactionId: TX_ID, meant: 'done', failureEffects: 'manual',
      }))
    })

    it('not-sent but releaseNotSent lost: no retryable throw, logs and returns', async () => {
      const h = makeHarness(stakeTx, { outcome: { kind: 'not-sent', code: 'ECONNREFUSED' } })
      h.tx.releaseNotSent.mockResolvedValue(false)
      moved(h, 'done')

      await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('moved-meanwhile')

      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('row moved meanwhile'), expect.objectContaining({
        transactionId: TX_ID, meant: 'pending', failureEffects: 'done',
      }))
      expect(logMock.warn).not.toHaveBeenCalledWith(expect.stringContaining('will retry'), expect.anything())
    })

    it('ambiguous but releaseManual lost: warns row moved meanwhile instead of the manual error', async () => {
      const outcome: ReleaseOutcome = { kind: 'ambiguous', status: 500, message: 'HTTP 500 Internal Server Error' }
      const h = makeHarness(stakeTx, { outcome })
      h.tx.releaseManual.mockResolvedValue(false)
      moved(h, 'pending')

      await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('moved-meanwhile')

      expect(logMock.error).not.toHaveBeenCalled()
      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('row moved meanwhile'), expect.objectContaining({
        transactionId: TX_ID, meant: 'manual', failureEffects: 'pending', outcome,
      }))
    })
  })

  it('never reads transactions.status: a success row with an owed release is still released', async () => {
    const h = makeHarness({ ...stakeTx, status: 'success' })

    await expect(h.activities.releaseFailedStake(TX_ID)).resolves.toBe('released')
  })
})

describe('markFailureEffectsExhausted', () => {
  it('returns what effectsExhausted returned, never throws on 0 rows', async () => {
    const h = makeHarness(stakeTx)
    await expect(h.activities.markFailureEffectsExhausted(TX_ID)).resolves.toBe(true)
    expect(h.tx.effectsExhausted).toHaveBeenCalledWith(TX_ID)

    h.tx.effectsExhausted.mockResolvedValue(false)
    await expect(h.activities.markFailureEffectsExhausted(TX_ID)).resolves.toBe(false)
  })
})

describe('notifyFailedTransactionOwner', () => {
  it('fence won on a verifier row (failureReleaseAddresses set): notifies with the row log as reason and its hash', async () => {
    const h = makeHarness({ ...stakeTx, failureReleaseAddresses: ['pokt1x'] })

    await expect(h.activities.notifyFailedTransactionOwner(TX_ID)).resolves.toBe(true)

    expect(h.tx.claimNotify).toHaveBeenCalledWith(TX_ID)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock.mock.calls[0][2]).toEqual({
      type: 'stake',
      ownerIdentity: 'pokt1owner',
      metadata: { outcome: 'failure', reason: 'out of funds', hash: 'ABC' },
    })
  })

  it('a broadcast-rejected row (hash, failureReleaseAddresses NULL): no hash key, CheckTx never let it on chain', async () => {
    const h = makeHarness({ ...stakeTx, hash: 'ABC', failureReleaseAddresses: null })

    await h.activities.notifyFailedTransactionOwner(TX_ID)

    expect(dispatchMock.mock.calls[0][2].metadata).toEqual({ outcome: 'failure', reason: 'out of funds' })
  })

  it('no hash (never broadcast): no hash key in the notice', async () => {
    const h = makeHarness({ ...stakeTx, hash: null, log: 'never broadcast: ExecuteTransaction kept failing for over an hour' })

    await h.activities.notifyFailedTransactionOwner(TX_ID)

    expect(dispatchMock.mock.calls[0][2].metadata).toEqual({
      outcome: 'failure', reason: 'never broadcast: ExecuteTransaction kept failing for over an hour',
    })
  })

  it('fence already set (lost): sends nothing and logs the tx id', async () => {
    const h = makeHarness(stakeTx)
    h.tx.claimNotify.mockResolvedValue(undefined)

    await expect(h.activities.notifyFailedTransactionOwner(TX_ID)).resolves.toBe(false)

    expect(dispatchMock).not.toHaveBeenCalled()
    expect(logMock.info).toHaveBeenCalledWith(expect.any(String), { transactionId: TX_ID })
  })

  it('a type with no user event (unknown type value): fence taken, nothing sent', async () => {
    const h = makeHarness({ ...stakeTx, type: 'NotATxType' })

    await expect(h.activities.notifyFailedTransactionOwner(TX_ID)).resolves.toBe(false)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('a fence CAS error propagates (retried by the activity policy), nothing sent', async () => {
    const h = makeHarness(stakeTx)
    h.tx.claimNotify.mockRejectedValue(new Error('db down'))

    await expect(h.activities.notifyFailedTransactionOwner(TX_ID)).rejects.toThrow('db down')
    expect(dispatchMock).not.toHaveBeenCalled()
  })
})
