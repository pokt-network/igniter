// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockGetAccount = jest.fn()
const mockGetHeight = jest.fn()
const mockDisconnect = jest.fn()

// Mock @cosmjs/stargate
jest.mock('@cosmjs/stargate', () => {
  const actual = jest.requireActual('@cosmjs/stargate')
  return {
    ...actual,
    StargateClient: {
      create: jest.fn().mockResolvedValue({
        getAccount: mockGetAccount,
        getHeight: mockGetHeight,
        disconnect: mockDisconnect,
      }),
    },
  }
})

// Mock @cosmjs/tendermint-rpc
jest.mock('@cosmjs/tendermint-rpc', () => ({
  connectComet: jest.fn().mockResolvedValue({
    disconnect: mockDisconnect,
  }),
}))

// Mock @igniter/logger
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

async function createInstance() {
  return PocketBlockchain.setup('http://localhost:26657', 'upokt', 0.001)
}

describe('PocketBlockchain.isSequenceConsumed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('consumed when account.sequence > txSequence; observedAtHeight sampled AT/AFTER the account read', async () => {
    mockGetAccount.mockResolvedValue({ sequence: 7, accountNumber: 1, address: 'pokt1signer', pubkey: null })
    mockGetHeight.mockResolvedValue(1234)

    const bc = await createInstance()
    const result = await bc.isSequenceConsumed('pokt1signer', 5)

    expect(result).toEqual({ consumed: true, observedAtHeight: 1234 })
    // getAccount must be called before getHeight to ensure observedAtHeight covers the account read
    const getAccountOrder = mockGetAccount.mock.invocationCallOrder[0]
    const getHeightOrder = mockGetHeight.mock.invocationCallOrder[0]
    expect(getAccountOrder).toBeLessThan(getHeightOrder)
  })

  it('not consumed when account.sequence equals txSequence', async () => {
    mockGetAccount.mockResolvedValue({ sequence: 5, accountNumber: 1, address: 'pokt1signer', pubkey: null })
    mockGetHeight.mockResolvedValue(2000)

    const bc = await createInstance()
    const result = await bc.isSequenceConsumed('pokt1signer', 5)

    expect(result).toEqual({ consumed: false, observedAtHeight: 2000 })
  })

  it('not consumed when account.sequence < txSequence', async () => {
    mockGetAccount.mockResolvedValue({ sequence: 3, accountNumber: 1, address: 'pokt1signer', pubkey: null })
    mockGetHeight.mockResolvedValue(3000)

    const bc = await createInstance()
    const result = await bc.isSequenceConsumed('pokt1signer', 5)

    expect(result).toEqual({ consumed: false, observedAtHeight: 3000 })
  })

  it('account not found → not consumed (safe default: tx could still land)', async () => {
    mockGetAccount.mockResolvedValue(null)
    mockGetHeight.mockResolvedValue(999)

    const bc = await createInstance()
    const result = await bc.isSequenceConsumed('pokt1unknown', 5)

    expect(result).toEqual({ consumed: false, observedAtHeight: 999 })
  })

  it('RPC error on getAccount → throws (caller maps to unavailable/pending)', async () => {
    mockGetAccount.mockRejectedValue(new Error('rpc unreachable'))

    const bc = await createInstance()

    await expect(bc.isSequenceConsumed('pokt1signer', 5)).rejects.toThrow('rpc unreachable')
  })
})
