import { verifyStakeGoalState } from './verifyStakeGoalStateHelper'
import { RPCType } from '@igniter/pocket'

// minimal supplier fixture
const baseSupplier = {
  ownerAddress: 'pokt1owner',
  stake: { amount: '1000000', denom: 'upokt' },
  services: [
    {
      serviceId: 'svc1',
      endpoints: [{ url: 'https://node.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
      revShare: [{ address: 'pokt1owner', revSharePercentage: 5 }],
    },
  ],
  serviceConfigHistory: [],
}

// minimal tx fixture
const makeTx = (overrides = {}) => ({
  unsignedPayload: JSON.stringify({
    body: {
      messages: [{
        typeUrl: '/pocket.supplier.MsgStakeSupplier',
        value: {
          signer: 'pokt1owner',
          ownerAddress: 'pokt1owner',
          operatorAddress: 'pokt1operator',
          stake: { denom: 'upokt', amount: 1000000 },
          services: [{
            serviceId: 'svc1',
            endpoints: [{ url: 'https://node.example.com', rpcType: 'JSON_RPC', configs: [] }],
            revShare: [{ address: 'pokt1owner', revSharePercentage: '5' }],
          }],
        },
      }],
    },
  }),
  ...overrides,
})

describe('verifyStakeGoalState', () => {
  it('all operators on-chain with matching config → confirmed', async () => {
    const getSupplier = jest.fn().mockResolvedValue(baseSupplier)
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toEqual({ status: 'confirmed' })
  })

  it('operator absent (getSupplier returns null) → absent with operatorAddress', async () => {
    const getSupplier = jest.fn().mockResolvedValue(null)
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toEqual({ status: 'absent', absentOperators: ['pokt1operator'] })
  })

  it('operator owner mismatch → absent', async () => {
    const getSupplier = jest.fn().mockResolvedValue({ ...baseSupplier, ownerAddress: 'pokt1other' })
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result.status).toBe('absent')
  })

  it('stake amount below intended → absent', async () => {
    const getSupplier = jest.fn().mockResolvedValue({ ...baseSupplier, stake: { amount: '500000', denom: 'upokt' } })
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result.status).toBe('absent')
  })

  it('services differ → absent lists that operator', async () => {
    const getSupplier = jest.fn().mockResolvedValue({
      ...baseSupplier,
      services: [{ serviceId: 'svc2', endpoints: [], revShare: [] }],
    })
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toMatchObject({ status: 'absent', absentOperators: ['pokt1operator'] })
  })

  it('services empty but serviceConfigHistory matches → confirmed (pending activation)', async () => {
    const getSupplier = jest.fn().mockResolvedValue({
      ...baseSupplier,
      services: [],
      serviceConfigHistory: [{
        service: {
          serviceId: 'svc1',
          endpoints: [{ url: 'https://node.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
          revShare: [{ address: 'pokt1owner', revSharePercentage: 5 }],
        },
      }],
    })
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toEqual({ status: 'confirmed' })
  })

  it('getSupplier throws → unavailable', async () => {
    const getSupplier = jest.fn().mockRejectedValue(new Error('RPC down'))
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('rpcType string "JSON_RPC" in tx normalizes to numeric enum correctly', async () => {
    // The tx message has rpcType: 'JSON_RPC' (string); on-chain has rpcType: 3 (RPCType.JSON_RPC)
    // They must compare as equal — this is the rpcType normalization regression guard
    const getSupplier = jest.fn().mockResolvedValue(baseSupplier) // rpcType: RPCType.JSON_RPC (3)
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toEqual({ status: 'confirmed' })
  })

  it('revShare as string "5" normalizes to number 5', async () => {
    // tx has revSharePercentage: '5' (string); on-chain has revSharePercentage: 5 (number)
    // They must compare as equal
    const getSupplier = jest.fn().mockResolvedValue(baseSupplier)
    const result = await verifyStakeGoalState(makeTx() as any, getSupplier)
    expect(result).toEqual({ status: 'confirmed' })
  })
})
