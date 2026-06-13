/**
 * Unit tests for supplierEffectFromKey v2 and Keys.flipState.
 * Task 7 / PR #308 verification hardening.
 */

// Mock heavy external dependencies that aren't relevant to these unit tests
jest.mock('@igniter/pocket', () => ({}))
jest.mock('@temporalio/activity', () => ({
  ApplicationFailure: { nonRetryable: jest.fn(), retryable: jest.fn() },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('@igniter/domain/provider/operations', () => ({
  BuildSupplierServiceConfigHandler: jest.fn(),
  CompareSupplierServiceConfigHandler: jest.fn(),
}))
jest.mock('@igniter/domain/provider/utils', () => ({
  getExpectedServicesFromKey: jest.fn(),
}))
jest.mock('@/lib/utils', () => ({
  addOrUpdateRemediationHistory: jest.fn(),
}))
jest.mock('@/lib/redactors', () => ({
  redactStakeSupplierParams: jest.fn(),
}))
jest.mock('@igniter/pocket/proto/pocket/shared/supplier', () => ({
  ServiceConfigUpdate: {},
}))

import { supplierEffectFromKey } from './index'
import { KeyState, RemediationHistoryEntryReason, TransactionType, TransactionStatus, TransactionTrigger } from '@igniter/db/provider/enums'
import type { Transaction } from '@igniter/db/provider/schema'

// Minimal transaction fixture
function makeTx(overrides: Partial<Record<string, unknown>> = {}): Transaction {
  return {
    id: 1,
    keyId: 10,
    keyAddress: 'pokt1addr',
    type: TransactionType.Stake,
    status: TransactionStatus.Pending,
    trigger: TransactionTrigger.Automatic,
    reason: null,
    hash: null,
    code: null,
    message: null,
    executionHeight: 1000,
    lastCoveredHeight: null,
    unavailableChecks: 0,
    lastVerificationAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Transaction
}

const key = { address: 'pokt1addr', stakeOwner: 'pokt1owner' }

describe('supplierEffectFromKey v2', () => {
  it('OwnerInitialStake → stake-services-present effect', () => {
    const tx = makeTx({ type: TransactionType.Stake, reason: RemediationHistoryEntryReason.OwnerInitialStake })
    const result = supplierEffectFromKey(tx, key)
    expect(result).not.toBeNull()
    expect(result!.operatorAddress).toBe('pokt1addr')
    expect(result!.effect.kind).toBe('stake-services-present')
    expect((result!.effect as unknown as { kind: 'stake-services-present'; ownerAddress: string }).ownerAddress).toBe('pokt1owner')
  })

  it('ServiceMismatch stake tx → null (hash-only; existence proves nothing for config update)', () => {
    const tx = makeTx({ type: TransactionType.Stake, reason: RemediationHistoryEntryReason.ServiceMismatch })
    expect(supplierEffectFromKey(tx, key)).toBeNull()
  })

  it('AddressGroupMigration stake tx → null (hash-only)', () => {
    const tx = makeTx({ type: TransactionType.Stake, reason: RemediationHistoryEntryReason.AddressGroupMigration })
    expect(supplierEffectFromKey(tx, key)).toBeNull()
  })

  it('Stake tx with no reason → null (conservative: unknown reason cannot assert goal-state)', () => {
    const tx = makeTx({ type: TransactionType.Stake, reason: null })
    expect(supplierEffectFromKey(tx, key)).toBeNull()
  })

  it('Unstake tx → unstake effect with minSessionEndHeight from executionHeight', () => {
    const tx = makeTx({ type: TransactionType.Unstake, executionHeight: 5000 })
    const result = supplierEffectFromKey(tx, key)
    expect(result).not.toBeNull()
    expect(result!.effect.kind).toBe('unstake')
    expect((result!.effect as { kind: 'unstake'; minSessionEndHeight: number }).minSessionEndHeight).toBe(5000)
  })

  it('Unstake tx with null executionHeight → minSessionEndHeight 0', () => {
    const tx = makeTx({ type: TransactionType.Unstake, executionHeight: null })
    const result = supplierEffectFromKey(tx, key)
    expect(result!.effect.kind).toBe('unstake')
    expect((result!.effect as { kind: 'unstake'; minSessionEndHeight: number }).minSessionEndHeight).toBe(0)
  })
})

// ---- verifySupplierEffect deep-compare tests (Task 15) ----

import { providerActivities } from './index'
import { CompareSupplierServiceConfigHandler } from '@igniter/domain/provider/operations'
import { getExpectedServicesFromKey } from '@igniter/domain/provider/utils'
import type { KeyWithGroup } from '@igniter/db/provider/schema'

const OPERATOR = 'pokt1operator'
const OWNER = 'pokt1owner'

const intendedService = { serviceId: 'svc1', endpoints: [{ url: 'https://example.com', rpcType: 1, configs: [] }], revShare: [{ address: OWNER, revSharePercentage: 100 }] }
const staleService = { serviceId: 'stale', endpoints: [{ url: 'https://stale.com', rpcType: 1, configs: [] }], revShare: [{ address: OWNER, revSharePercentage: 100 }] }

function makeActivities(getSupplierResult: 'throw' | null | object) {
  const mockCompare = jest.fn().mockReturnValue({ isEqual: false })
  ;(CompareSupplierServiceConfigHandler as jest.Mock).mockImplementation(() => ({ execute: mockCompare }))
  ;(getExpectedServicesFromKey as jest.Mock).mockReturnValue([intendedService])

  const mockDal = {
    transactions: {
      getTransaction: jest.fn().mockResolvedValue({
        id: 1, keyAddress: OPERATOR, type: TransactionType.Stake,
        reason: RemediationHistoryEntryReason.OwnerInitialStake,
        hash: 'abc', executionHeight: 1000, status: 'pending',
      }),
    },
    keys: {
      loadKey: jest.fn().mockResolvedValue({
        address: OPERATOR,
        stakeOwner: OWNER,
        group: { services: [] },
      } as unknown as KeyWithGroup),
    },
  } as any

  const mockPocket = {
    getSupplier: getSupplierResult === 'throw'
      ? jest.fn().mockRejectedValue(new Error('rpc error'))
      : jest.fn().mockResolvedValue(getSupplierResult),
    verifySupplierEffect: jest.fn(),
  } as any

  return { activities: providerActivities(mockDal, mockPocket), mockCompare }
}

describe('verifySupplierEffect — OwnerInitialStake deep-compare (Task 15)', () => {
  it('(a) intended config matches active services → confirmed', async () => {
    const { activities, mockCompare } = makeActivities({
      ownerAddress: OWNER,
      services: [intendedService],
      serviceConfigHistory: [],
    })
    // First compare (active services) returns isEqual: true
    mockCompare.mockReturnValueOnce({ isEqual: true })
    const result = await activities.verifySupplierEffect(1)
    expect(result).toEqual({ status: 'confirmed' })
  })

  it('(b) supplier has stale/different services → absent', async () => {
    const { activities, mockCompare } = makeActivities({
      ownerAddress: OWNER,
      services: [staleService],
      serviceConfigHistory: [],
    })
    // All compares return isEqual: false (stale)
    mockCompare.mockReturnValue({ isEqual: false })
    const result = await activities.verifySupplierEffect(1)
    expect(result).toEqual({ status: 'absent', absentOperators: [OPERATOR] })
  })

  it('(c) active services empty but pending serviceConfigHistory entry matches → confirmed', async () => {
    const { activities, mockCompare } = makeActivities({
      ownerAddress: OWNER,
      services: [],
      serviceConfigHistory: [{ service: intendedService, activationHeight: 1010, deactivationHeight: 0 }],
    })
    // First compare (active, empty array) → not equal; second compare (history entry) → equal
    mockCompare
      .mockReturnValueOnce({ isEqual: false }) // active services check
      .mockReturnValueOnce({ isEqual: true })  // pending history check
    const result = await activities.verifySupplierEffect(1)
    expect(result).toEqual({ status: 'confirmed' })
  })

  it('(d) owner mismatch → absent', async () => {
    const { activities } = makeActivities({
      ownerAddress: 'pokt1differentowner',
      services: [intendedService],
      serviceConfigHistory: [],
    })
    const result = await activities.verifySupplierEffect(1)
    expect(result).toEqual({ status: 'absent', absentOperators: [OPERATOR] })
  })

  it('getSupplier throws → unavailable', async () => {
    const { activities } = makeActivities('throw')
    const result = await activities.verifySupplierEffect(1)
    expect(result).toEqual({ status: 'unavailable' })
  })
})

// ---- Keys.flipState tests ----

import Keys from '@/lib/dal/keys'

function makeDbClient(updatedRows: { id: number }[]) {
  return {
    db: {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => updatedRows,
          }),
        }),
      }),
    },
  } as any
}

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any

describe('Keys.flipState', () => {
  it('returns true when a row was updated', async () => {
    const keys = new Keys(makeDbClient([{ id: 1 }]), mockLogger)
    const result = await keys.flipState('pokt1addr', KeyState.Staked, { notFromStates: [KeyState.Unstaking] })
    expect(result).toBe(true)
  })

  it('returns false when 0 rows updated (state was in blocked set → no-op CAS)', async () => {
    const keys = new Keys(makeDbClient([]), mockLogger)
    const result = await keys.flipState('pokt1addr', KeyState.RemediationFailed, {
      notFromStates: [KeyState.Unstaking, KeyState.Unstaked, KeyState.AttentionNeeded],
    })
    expect(result).toBe(false)
  })
})
