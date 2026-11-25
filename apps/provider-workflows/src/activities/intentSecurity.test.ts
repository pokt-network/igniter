/**
 * The provider activities must not let a party that
 * can start workflows (or schedule activities) on the provider task queue move funds or
 * keys. These tests drive the real activities over an in-memory DAL and a fake chain.
 */

jest.mock('@igniter/pocket', () => ({}))
jest.mock('@temporalio/activity', () => {
  const fail = (message: string, type?: string) => Object.assign(new Error(message), { type })
  return {
    ApplicationFailure: Object.assign(jest.fn(), { nonRetryable: jest.fn(fail), retryable: jest.fn(fail) }),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    Context: { current: () => ({ cancellationSignal: { throwIfAborted: () => undefined } }) },
    heartbeat: jest.fn(),
  }
})
jest.mock('@igniter/domain/provider/operations', () => ({
  BuildSupplierServiceConfigHandler: jest.fn().mockImplementation(() => ({ execute: () => [{ serviceId: 'anvil' }] })),
  CompareSupplierServiceConfigHandler: jest.fn().mockImplementation(() => ({ execute: () => ({ isEqual: true }) })),
}))
jest.mock('@igniter/domain/provider/utils', () => ({
  getExpectedServicesFromKey: jest.fn(() => []),
}))
jest.mock('@/lib/redactors', () => ({
  redactStakeSupplierParams: jest.fn(),
}))
jest.mock('@igniter/pocket/proto/pocket/shared/supplier', () => ({
  ServiceConfigUpdate: {},
}))

import { KeyState, RemediationHistoryEntryReason, TransactionType } from '@igniter/db/provider/enums'
import {
  parseReturnFundsInputChoice,
  providerActivities,
  sanitizeKeyStates,
  sanitizeRemediationReasons,
} from './index'
import { clampConcurrency, MAX_RANGE_CONCURRENCY } from '@/workflows/supplierStatusUtils'

const OP = 'pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp04723y'
const OWNER = 'pokt1qgpqyqszqgpqyqszqgpqyqszqgpqyqsz73c06j'
const CUSTOM = 'pokt1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrlpewsn'
const OTHER_ADDRESS = 'pokt1qszqgpqyqszqgpqyqszqgpqyqszqgpqyl37th0'
const DB_KEY = 'db-decrypted-private-key'

type AnyRecord = Record<string, any>

function makeKey(over: AnyRecord = {}): AnyRecord {
  return {
    id: 10,
    address: OP,
    privateKey: DB_KEY,
    state: KeyState.Staked,
    stakeOwner: OWNER,
    ownerAddress: OWNER,
    retiredAt: null,
    remediationHistory: [],
    services: [{ serviceId: 'anvil' }],
    delegatorRewardsAddress: '',
    addressGroup: { id: 1 },
    ...over,
  }
}

function makeEnv(opts: { key?: AnyRecord; txn?: AnyRecord; supplier?: AnyRecord | null; height?: number; settings?: AnyRecord } = {}) {
  const key = opts.key === undefined ? makeKey() : opts.key
  const dal = {
    keys: {
      loadKey: jest.fn(async () => key),
      updateKey: jest.fn(async () => undefined),
      setRetiredAt: jest.fn(async () => undefined),
      filterKnownAddresses: jest.fn(async (a: string[]) => a),
    },
    settings: { loadSettings: jest.fn(async () => opts.settings ?? {}) },
    services: { loadServices: jest.fn(async () => [{ serviceId: 'anvil' }]) },
    transactions: {
      getTransaction: jest.fn(async () => opts.txn),
      createIntent: jest.fn(async () => 77),
      abandonIntent: jest.fn(async () => undefined),
      recordSigned: jest.fn(async () => undefined),
    },
    delegators: {
      listAll: jest.fn(async () => [] as AnyRecord[]),
      upsertFromGovernance: jest.fn(async () => ({ inserted: 0, updated: 0, disabled: 0 })),
    },
  }
  const signed = { signedPayload: 'b64', transactionHash: 'HASH', timeoutTimestamp: new Date(0) }
  const chain = {
    getHeight: jest.fn(async () => opts.height ?? 100),
    getBalance: jest.fn(async () => 5_000),
    getSupplier: jest.fn(async () => (opts.supplier === undefined ? null : opts.supplier)),
    getSpendableBalance: jest.fn(async () => 10_000),
    signSupplierTx: jest.fn(async () => signed),
    signUnstakeAndDrainTx: jest.fn(async () => signed),
    signSendTx: jest.fn(async () => signed),
  }
  const activities = providerActivities(dal as never, chain as never)
  return { dal, chain, activities }
}

function intentRow(params: AnyRecord, type = TransactionType.Unstake): AnyRecord {
  return { id: 5, keyId: 10, keyAddress: OP, type, params: JSON.stringify(params) }
}

describe('no drain destination from a workflow/activity input', () => {
  it('createIntentTx and createReturnFundsIntent are not registered activities', () => {
    const { activities } = makeEnv()
    expect(activities).not.toHaveProperty('createIntentTx')
    expect(activities).not.toHaveProperty('createReturnFundsIntent')
  })

  it('parseReturnFundsInputChoice accepts owner/none and strips extra fields', () => {
    expect(parseReturnFundsInputChoice({ mode: 'owner', address: OTHER_ADDRESS })).toEqual({ mode: 'owner' })
    expect(parseReturnFundsInputChoice({ mode: 'none' })).toEqual({ mode: 'none' })
  })

  it.each([
    ['custom', { mode: 'custom', address: OTHER_ADDRESS }],
    ['missing', undefined],
    ['unknown mode', { mode: 'everything' }],
  ])('createUnstakeIntent rejects returnFunds %s (raw JSON input) and writes nothing', async (_l, returnFunds) => {
    const { activities, dal } = makeEnv()
    const raw = JSON.parse(JSON.stringify({ keyAddress: OP, returnFunds: returnFunds ?? null }))
    await expect(activities.createUnstakeIntent(raw)).rejects.toMatchObject({ type: 'invalid_return_funds' })
    expect(dal.transactions.createIntent).not.toHaveBeenCalled()
  })

  it('createUnstakeIntent (owner) stores no private key and forces trigger Manual', async () => {
    const { activities, dal } = makeEnv()
    await activities.createUnstakeIntent({ keyAddress: OP, returnFunds: { mode: 'owner' }, trigger: 'automatic' } as never)
    const values = (dal.transactions.createIntent.mock.calls[0] as unknown as [AnyRecord])[0]
    expect(values.params).not.toContain('signerPrivateKey')
    expect(values.params).not.toContain(DB_KEY)
    expect(JSON.parse(values.params)).toEqual({ kind: 'unstake', params: { signer: OP, operatorAddress: OP }, returnFunds: { mode: 'owner' } })
    expect(values.trigger).toBe('manual')
  })
})

describe('signSupplierTx signs with the key loaded from the keys table', () => {
  it('legacy stake row: ignores the signerPrivateKey stored in params, signs with the DB key', async () => {
    const txn = intentRow({ signerPrivateKey: 'stale-key-in-params', signer: OP, ownerAddress: OWNER, operatorAddress: OP, services: [] }, TransactionType.Stake)
    const { activities, chain, dal } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signSupplierTx).toHaveBeenCalledWith(expect.objectContaining({ signerPrivateKey: DB_KEY, operatorAddress: OP }))
    expect(dal.transactions.recordSigned).toHaveBeenCalled()
  })

  it('unstake row without a key in params (post-migration shape) still signs, draining to the recorded owner', async () => {
    const txn = intentRow({ kind: 'unstake', params: { signer: OP, operatorAddress: OP }, returnFunds: { mode: 'owner' } })
    const { activities, chain, dal } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signUnstakeAndDrainTx).toHaveBeenCalledWith(expect.objectContaining({
      signerPrivateKey: DB_KEY, operatorAddress: OP, drainTo: OWNER, drainAmount: String(10_000 - 1000),
    }))
    expect(dal.transactions.recordSigned).toHaveBeenCalled()
  })

  it('unstake row written by the provider app with a custom destination drains there', async () => {
    const txn = intentRow({ kind: 'unstake', params: { signer: OP, operatorAddress: OP }, returnFunds: { mode: 'custom', address: CUSTOM } })
    const { activities, chain } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signUnstakeAndDrainTx).toHaveBeenCalledWith(expect.objectContaining({ drainTo: CUSTOM }))
  })

  it('unstake row with an invalid custom destination is abandoned, never signed', async () => {
    const txn = intentRow({ kind: 'unstake', params: { signer: OP, operatorAddress: OP }, returnFunds: { mode: 'custom', address: 'pokt1x' } })
    const { activities, chain, dal } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signUnstakeAndDrainTx).not.toHaveBeenCalled()
    expect(dal.transactions.abandonIntent).toHaveBeenCalled()
  })

  it('a row whose signer is not the row key is abandoned, never signed', async () => {
    const txn = intentRow({ kind: 'unstake', params: { signer: OTHER_ADDRESS, operatorAddress: OTHER_ADDRESS }, returnFunds: { mode: 'none' } })
    const { activities, chain, dal } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signUnstakeAndDrainTx).not.toHaveBeenCalled()
    expect(dal.transactions.abandonIntent).toHaveBeenCalled()
  })

  it('return_funds to the recorded owner signs with the DB key', async () => {
    const txn = intentRow({ kind: 'return_funds', params: { fromAddress: OP, toAddress: OWNER, amount: [] } }, TransactionType.ReturnFunds)
    const { activities, chain } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signSendTx).toHaveBeenCalledWith(
      expect.objectContaining({ signerPrivateKey: DB_KEY, fromAddress: OP, toAddress: OWNER, amount: [{ denom: 'upokt', amount: '9000' }] }),
      1000,
    )
  })

  it('return_funds to anyone but the recorded owner is abandoned', async () => {
    const txn = intentRow({ kind: 'return_funds', params: { fromAddress: OP, toAddress: OTHER_ADDRESS, amount: [] } }, TransactionType.ReturnFunds)
    const { activities, chain, dal } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signSendTx).not.toHaveBeenCalled()
    expect(dal.transactions.abandonIntent).toHaveBeenCalled()
  })

  it('stake naming an owner other than the recorded stake owner is abandoned', async () => {
    const txn = intentRow({ kind: 'stake', params: { signer: OP, ownerAddress: OTHER_ADDRESS, operatorAddress: OP, services: [] } }, TransactionType.Stake)
    const { activities, chain, dal } = makeEnv({ txn })
    await activities.signSupplierTx(5)
    expect(chain.signSupplierTx).not.toHaveBeenCalled()
    expect(dal.transactions.abandonIntent).toHaveBeenCalled()
  })
})

describe('upsertSupplierStatus', () => {
  const supplier = (over: AnyRecord = {}) => ({
    ownerAddress: OWNER, operatorAddress: OP, stake: { amount: '100' }, unstakeSessionEndHeight: 0,
    services: [{ serviceId: 'anvil' }], serviceConfigHistory: [], ...over,
  })

  it('uses the chain height, not the input height', async () => {
    // unbonding ends at 500; chain is at 100 → Unstaking. The input height (10_000) would say Unstaked.
    const { activities, dal } = makeEnv({ supplier: supplier({ unstakeSessionEndHeight: 500 }), height: 100 })
    const r = await activities.upsertSupplierStatus({ address: OP, height: 10_000 })
    expect(r.state).toBe(KeyState.Unstaking)
    const [, update, h] = dal.keys.updateKey.mock.calls[0] as unknown as [string, AnyRecord, number]
    expect(update.lastUpdatedHeight).toBe(100)
    expect(h).toBe(100)
  })

  it('an owner change first seen on the RPC does not overwrite stakeOwner and flags a staked key', async () => {
    const { activities, dal } = makeEnv({ supplier: supplier({ ownerAddress: OTHER_ADDRESS }) })
    const r = await activities.upsertSupplierStatus({ address: OP })
    const [, update] = dal.keys.updateKey.mock.calls[0] as unknown as [string, AnyRecord]
    expect(update.stakeOwner).toBeUndefined()
    expect(r.state).toBe(KeyState.AttentionNeeded)
  })

  it('an owner change on an unbonding key blocks the automatic drain', async () => {
    const { activities, dal } = makeEnv({
      supplier: supplier({ ownerAddress: OTHER_ADDRESS, unstakeSessionEndHeight: 500 }),
      settings: { returnSupplierFundsToOwner: true },
    })
    await activities.upsertSupplierStatus({ address: OP })
    expect(dal.transactions.createIntent).not.toHaveBeenCalled()
  })

  it('with a matching owner the automatic drain goes to the recorded owner, with no key in params', async () => {
    const { activities, dal } = makeEnv({
      supplier: supplier({ unstakeSessionEndHeight: 500 }),
      settings: { returnSupplierFundsToOwner: true },
    })
    await activities.upsertSupplierStatus({ address: OP })
    const values = (dal.transactions.createIntent.mock.calls[0] as unknown as [AnyRecord])[0]
    expect(values.type).toBe(TransactionType.ReturnFunds)
    expect(JSON.parse(values.params)).toEqual({ kind: 'return_funds', params: { fromAddress: OP, toAddress: OWNER, amount: [] } })
  })

  it('records the owner the first time one is seen', async () => {
    const { activities, dal } = makeEnv({ key: makeKey({ stakeOwner: null }), supplier: supplier() })
    await activities.upsertSupplierStatus({ address: OP })
    const [, update] = dal.keys.updateKey.mock.calls[0] as unknown as [string, AnyRecord]
    expect(update.stakeOwner).toBe(OWNER)
  })
})

describe('remediateSupplier', () => {
  const history = [{ reason: RemediationHistoryEntryReason.ServiceMismatch, message: 'm', timestamp: 1 }]

  it('refuses to stake when the on-chain owner differs from the recorded stake owner', async () => {
    const { activities, dal } = makeEnv({
      key: makeKey({ remediationHistory: history }),
      supplier: { ownerAddress: OTHER_ADDRESS, services: [], serviceConfigHistory: [], stake: { amount: '1' } },
    })
    const r = await activities.remediateSupplier({ address: OP, reasons: [RemediationHistoryEntryReason.ServiceMismatch] })
    expect(r).toMatchObject({ remediated: false })
    expect(dal.transactions.createIntent).not.toHaveBeenCalled()
  })

  it('creates a stake intent with no private key in params', async () => {
    const { activities, dal } = makeEnv({
      key: makeKey({ remediationHistory: history }),
      supplier: { ownerAddress: OWNER, services: [], serviceConfigHistory: [], stake: { amount: '1' } },
    })
    await activities.remediateSupplier({ address: OP, reasons: [RemediationHistoryEntryReason.ServiceMismatch] })
    const values = (dal.transactions.createIntent.mock.calls[0] as unknown as [AnyRecord])[0]
    expect(values.params).not.toContain('signerPrivateKey')
    expect(values.params).not.toContain(DB_KEY)
  })

  it('drops input reasons it cannot remediate', () => {
    expect(sanitizeRemediationReasons([
      RemediationHistoryEntryReason.ServiceMismatch, 'bogus', RemediationHistoryEntryReason.SupplierFundsTooLow,
      RemediationHistoryEntryReason.ServiceMismatch,
    ])).toEqual([RemediationHistoryEntryReason.ServiceMismatch])
    expect(sanitizeRemediationReasons('x')).toEqual([])
  })
})

describe('range inputs', () => {
  it('sanitizeKeyStates keeps only real KeyState values', () => {
    expect(sanitizeKeyStates([KeyState.Staked, 'nope', KeyState.Staked])).toEqual([KeyState.Staked])
    expect(sanitizeKeyStates(undefined)).toEqual([])
  })

  it('clampConcurrency bounds the fan-out', () => {
    expect(clampConcurrency(10)).toBe(10)
    expect(clampConcurrency(1e9)).toBe(MAX_RANGE_CONCURRENCY)
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(-5)).toBe(1)
    expect(clampConcurrency(undefined)).toBe(MAX_RANGE_CONCURRENCY)
    expect(clampConcurrency('7')).toBe(MAX_RANGE_CONCURRENCY)
  })
})

describe('syncDelegatorsFromGovernance', () => {
  const realFetch = global.fetch
  const env = process.env.DELEGATORS_CDN_URL
  beforeEach(() => { process.env.DELEGATORS_CDN_URL = 'https://cdn.test/{chainId}.json' })
  afterEach(() => { global.fetch = realFetch; process.env.DELEGATORS_CDN_URL = env })

  const respond = (body: unknown) => {
    global.fetch = jest.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })) as never
  }
  const row = (i: number) => ({ name: `d${i}`, identity: `id${i}`, identityHistory: [] })

  it('rejects a payload that does not match the schema, writing nothing', async () => {
    const { activities, dal } = makeEnv({ settings: { chainId: 'pocket', ownerIdentity: 'me' } })
    respond([{ name: 'x' }])
    await expect(activities.syncDelegatorsFromGovernance()).rejects.toMatchObject({ type: 'invalid_payload' })
    expect(dal.delegators.upsertFromGovernance).not.toHaveBeenCalled()
  })

  it('refuses a run with more changes than the cap', async () => {
    const { activities, dal } = makeEnv({ settings: { chainId: 'pocket', ownerIdentity: 'me' } })
    dal.delegators.listAll.mockResolvedValue([{ id: 1, name: 'old', identity: 'old', enabled: true }])
    respond(Array.from({ length: 30 }, (_, i) => row(i)))
    await expect(activities.syncDelegatorsFromGovernance()).rejects.toMatchObject({ type: 'change_cap_exceeded' })
    expect(dal.delegators.upsertFromGovernance).not.toHaveBeenCalled()
  })

  it('applies a run under the cap', async () => {
    const { activities, dal } = makeEnv({ settings: { chainId: 'pocket', ownerIdentity: 'me' } })
    dal.delegators.listAll.mockResolvedValue([{ id: 1, name: 'old', identity: 'id0', enabled: true }])
    respond([row(0), row(1)])
    await activities.syncDelegatorsFromGovernance()
    expect(dal.delegators.upsertFromGovernance).toHaveBeenCalledWith([row(0), row(1)], 'me')
  })
})
