// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockDisconnect = jest.fn()

jest.mock('@cosmjs/stargate', () => {
  const actual = jest.requireActual('@cosmjs/stargate')
  return {
    ...actual,
    StargateClient: {
      create: jest.fn().mockResolvedValue({ disconnect: mockDisconnect }),
    },
  }
})

jest.mock('@cosmjs/tendermint-rpc', () => ({
  connectComet: jest.fn().mockResolvedValue({ disconnect: mockDisconnect }),
}))

jest.mock('@igniter/logger', () => {
  const mk = () => {
    const l: Record<string, unknown> = {
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), trace: jest.fn(),
      with: () => l, getChild: () => l,
    }
    return l
  }
  return { getLogger: () => mk() }
})

import { PocketBlockchain } from './index'
import type { Supplier } from '@pocket/proto/generated/pocket/shared/supplier'
import type { SupplierEffect } from './index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPERATOR = 'pokt1operator'
const OWNER = 'pokt1owner'

async function createInstance() {
  return PocketBlockchain.setup('http://localhost:26657', 'upokt', 0.001)
}

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    ownerAddress: OWNER,
    operatorAddress: OPERATOR,
    stake: { denom: 'upokt', amount: '1000000' },
    services: [],
    unstakeSessionEndHeight: 0,
    serviceConfigHistory: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PocketBlockchain.verifySupplierEffect', () => {
  let bc: PocketBlockchain
  let getSupplierSpy: jest.SpyInstance

  beforeEach(async () => {
    jest.clearAllMocks()
    bc = await createInstance()
    getSupplierSpy = jest.spyOn(bc, 'getSupplier')
  })

  it('stake-services-present: owner matches and services present → confirmed', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ services: [{ serviceId: 'svc1', endpoints: [], revShare: [] }] }))
    const effect: SupplierEffect = { kind: 'stake-services-present', ownerAddress: OWNER }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('confirmed')
  })

  it('stake-services-present: owner matches but services empty → absent', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ services: [], serviceConfigHistory: [] }))
    const effect: SupplierEffect = { kind: 'stake-services-present', ownerAddress: OWNER }
    const r = await bc.verifySupplierEffect(OPERATOR, effect, 999)
    expect(r).toEqual({ status: 'absent', coveredUpToHeight: 999 })
  })

  it('stake-services-present: owner mismatch → absent', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ ownerAddress: 'pokt1other' }))
    const effect: SupplierEffect = { kind: 'stake-services-present', ownerAddress: OWNER }
    const r = await bc.verifySupplierEffect(OPERATOR, effect, 999)
    expect(r).toEqual({ status: 'absent', coveredUpToHeight: 999 })
  })

  it('upstake: staked >= min → confirmed', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ stake: { denom: 'upokt', amount: '5000000' } }))
    const effect: SupplierEffect = { kind: 'upstake', ownerAddress: OWNER, minStakeUpokt: 5000000n }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('confirmed')
  })

  it('upstake: staked below min → absent', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ stake: { denom: 'upokt', amount: '4000000' } }))
    const effect: SupplierEffect = { kind: 'upstake', ownerAddress: OWNER, minStakeUpokt: 5000000n }
    const r = await bc.verifySupplierEffect(OPERATOR, effect, 1234)
    expect(r).toEqual({ status: 'absent', coveredUpToHeight: 1234 })
  })

  it('unstake: session end >= broadcast height → confirmed', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ unstakeSessionEndHeight: 42 }))
    const effect: SupplierEffect = { kind: 'unstake', minSessionEndHeight: 10 }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('confirmed')
  })

  it('unstake: not unbonding (session end 0) → absent', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ unstakeSessionEndHeight: 0 }))
    const effect: SupplierEffect = { kind: 'unstake', minSessionEndHeight: 10 }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('absent')
  })

  it('unstake: pre-existing unbonding below broadcast height → absent (no false positive)', async () => {
    // Node already unbonding from an earlier session (endHeight 5) when we broadcast at 10.
    getSupplierSpy.mockResolvedValue(makeSupplier({ unstakeSessionEndHeight: 5 }))
    const effect: SupplierEffect = { kind: 'unstake', minSessionEndHeight: 10 }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('absent')
  })

  it('getSupplier throws → unavailable', async () => {
    getSupplierSpy.mockRejectedValue(new Error('rpc unreachable'))
    const effect: SupplierEffect = { kind: 'stake', ownerAddress: OWNER }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('unavailable')
  })

  it('getSupplier returns null (NotFound) → absent', async () => {
    getSupplierSpy.mockResolvedValue(null)
    const effect: SupplierEffect = { kind: 'stake', ownerAddress: OWNER }
    const r = await bc.verifySupplierEffect(OPERATOR, effect, 99)
    expect(r).toEqual({ status: 'absent', coveredUpToHeight: 99 })
  })
})
