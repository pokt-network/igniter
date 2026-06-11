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

jest.mock('@igniter/logger', () => ({
  getLogger: () => ({
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}))

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

  it('stake: owner matches → confirmed', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier())
    const effect: SupplierEffect = { kind: 'stake', ownerAddress: OWNER }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('confirmed')
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

  it('unstake: unstakeSessionEndHeight > 0 → confirmed', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ unstakeSessionEndHeight: 42 }))
    const effect: SupplierEffect = { kind: 'unstake' }
    const r = await bc.verifySupplierEffect(OPERATOR, effect)
    expect(r.status).toBe('confirmed')
  })

  it('unstake: unstakeSessionEndHeight === 0 → absent', async () => {
    getSupplierSpy.mockResolvedValue(makeSupplier({ unstakeSessionEndHeight: 0 }))
    const effect: SupplierEffect = { kind: 'unstake' }
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
