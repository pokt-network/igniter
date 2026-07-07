import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'

// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockGetTx = jest.fn()
const mockGetHeight = jest.fn()
const mockBlock = jest.fn()
const mockBlockResults = jest.fn()
const mockDisconnect = jest.fn()

// Mock @cosmjs/stargate
jest.mock('@cosmjs/stargate', () => {
  const actual = jest.requireActual('@cosmjs/stargate')
  return {
    ...actual,
    StargateClient: {
      create: jest.fn().mockResolvedValue({
        getTx: mockGetTx,
        getHeight: mockGetHeight,
        disconnect: mockDisconnect,
      }),
    },
  }
})

// Mock @cosmjs/tendermint-rpc
jest.mock('@cosmjs/tendermint-rpc', () => ({
  connectComet: jest.fn().mockResolvedValue({
    block: mockBlock,
    blockResults: mockBlockResults,
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

// Mock global fetch
const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { PocketBlockchain } from './index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createInstance(apiUrl?: string) {
  return PocketBlockchain.setup('http://localhost:26657', 'upokt', 0.001, apiUrl)
}

// Build TX bytes and compute the expected hash (same logic as getTransactionFromBlock)
const txContent = Buffer.from('some-tx-content')
const txHashBytes = sha256(txContent)
const txHash = toHex(txHashBytes).toUpperCase()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PocketBlockchain.getTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: chain head far ahead so the Tier-3 block scan walks its full
    // window unless a test overrides it to exercise the head-cap.
    mockGetHeight.mockResolvedValue(10_000_000)
  })

  // 1. Tier 1 success
  it('returns Tier 1 result when RPC getTx succeeds', async () => {
    const rpcResult = {
      hash: txHash,
      height: 100,
      txIndex: 0,
      gasUsed: BigInt(50000),
      gasWanted: BigInt(100000),
      code: 0,
    }
    mockGetTx.mockResolvedValue(rpcResult)

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash)

    expect(result).toEqual({
      hash: txHash,
      height: 100,
      index: 0,
      gasUsed: BigInt(50000),
      gasWanted: BigInt(100000),
      success: true,
      code: 0,
    })
    // fetch should NOT have been called (Tier 2 skipped)
    expect(mockFetch).not.toHaveBeenCalled()
    // block should NOT have been called (Tier 3 skipped)
    expect(mockBlock).not.toHaveBeenCalled()
  })

  // 2. Tier 1 null + Tier 2 success
  it('falls back to REST API when RPC returns null', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tx_response: {
          txhash: txHash,
          height: '200',
          tx_index: 3,
          gas_used: '80000',
          gas_wanted: '120000',
          code: 0,
        },
      }),
    })

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash)

    expect(result).toEqual({
      hash: txHash,
      height: 200,
      index: 3,
      gasUsed: BigInt(80000),
      gasWanted: BigInt(120000),
      success: true,
      code: 0,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `http://api.example.com/cosmos/tx/v1beta1/txs/${txHash}`,
    )
    expect(mockBlock).not.toHaveBeenCalled()
  })

  // 3. Tier 1 null + Tier 2 null + Tier 3 success (block scan)
  it('falls back to block scan when both RPC and API return null', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })

    const startHeight = 500
    mockBlock.mockResolvedValue({
      block: {
        txs: [Uint8Array.from(txContent)],
      },
    })
    mockBlockResults.mockResolvedValue({
      results: [
        {
          gasUsed: BigInt(60000),
          gasWanted: BigInt(90000),
          code: 0,
        },
      ],
    })

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash, startHeight)

    expect(result).toEqual({
      hash: txHash,
      height: startHeight,
      index: 0,
      gasUsed: BigInt(60000),
      gasWanted: BigInt(90000),
      success: true,
      code: 0,
    })
    expect(mockBlock).toHaveBeenCalledWith(startHeight)
    expect(mockBlockResults).toHaveBeenCalledWith(startHeight)
  })

  // 4. All tiers return null
  it('returns null when all tiers fail', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })
    mockBlock.mockResolvedValue({ block: { txs: [] } })

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash, 100)

    expect(result).toBeNull()
  })

  // 5. No apiUrl + no height: only Tier 1 tried
  it('only tries Tier 1 when no apiUrl and no height provided', async () => {
    mockGetTx.mockResolvedValue(null)

    const bc = await createInstance() // no apiUrl
    const result = await bc.getTransaction(txHash)

    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockBlock).not.toHaveBeenCalled()
  })

  // 6. API response parsing: verify tx_response fields map correctly
  it('correctly parses tx_response fields from API', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tx_response: {
          txhash: 'ABC123',
          height: '999',
          // tx_index absent → should be undefined
          gas_used: '12345',
          gas_wanted: '67890',
          code: 5, // non-zero → success false
        },
      }),
    })

    const bc = await createInstance('http://api.example.com/')
    const result = await bc.getTransaction('ABC123')

    expect(result).toEqual({
      hash: 'ABC123',
      height: 999,
      index: undefined,
      gasUsed: BigInt(12345),
      gasWanted: BigInt(67890),
      success: false,
      code: 5,
    })
    // Trailing slash should be stripped
    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/cosmos/tx/v1beta1/txs/ABC123',
    )
  })

  // 7. Block scan SHA256: verify hash matching with real SHA256
  it('matches TX by SHA256 hash in block scan', async () => {
    const customTxBytes = Buffer.from('unique-transaction-payload-for-sha256-test')
    const expectedHash = toHex(sha256(customTxBytes)).toUpperCase()

    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })

    // Block contains multiple TXs, target is at index 1
    const otherTx = Buffer.from('other-tx')
    mockBlock.mockResolvedValue({
      block: {
        txs: [Uint8Array.from(otherTx), Uint8Array.from(customTxBytes)],
      },
    })
    mockBlockResults.mockResolvedValue({
      results: [
        { gasUsed: BigInt(10), gasWanted: BigInt(20), code: 0 },
        { gasUsed: BigInt(77777), gasWanted: BigInt(88888), code: 0 },
      ],
    })

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(expectedHash, 42)

    expect(result).toEqual({
      hash: expectedHash,
      height: 42,
      index: 1,
      gasUsed: BigInt(77777),
      gasWanted: BigInt(88888),
      success: true,
      code: 0,
    })
  })

  // 8. Block scan caps at chain head: never fetch future heights
  it('does not scan past the current chain head during block scan', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })
    mockBlock.mockResolvedValue({ block: { txs: [] } }) // tx never present

    const startHeight = 1000
    // Head is only 2 blocks past the start: window must be 1000..1002 inclusive.
    mockGetHeight.mockResolvedValue(startHeight + 2)

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash, startHeight)

    expect(result).toBeNull()
    expect(mockBlock).toHaveBeenCalledWith(startHeight)
    expect(mockBlock).toHaveBeenCalledWith(startHeight + 1)
    expect(mockBlock).toHaveBeenCalledWith(startHeight + 2)
    // The default maxBlocks is 30, but the head cap must stop the scan at +2.
    expect(mockBlock).not.toHaveBeenCalledWith(startHeight + 3)
    expect(mockBlock).toHaveBeenCalledTimes(3)
  })

  // 9. Tx height ahead of chain head: scan is skipped entirely
  it('skips the block scan when the tx height is ahead of the chain head', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })

    const startHeight = 5000
    mockGetHeight.mockResolvedValue(startHeight - 1) // head below tx height

    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash, startHeight)

    expect(result).toBeNull()
    expect(mockBlock).not.toHaveBeenCalled()
  })

  // 10. getHeight failure: fall back to scanning the full maxBlocks window
  it('scans the full window when reading the chain head fails', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })
    mockBlock.mockResolvedValue({ block: { txs: [] } }) // tx never present
    mockGetHeight.mockRejectedValue(new Error('rpc unreachable')) // head unknown

    const startHeight = 2000
    const bc = await createInstance('http://api.example.com')
    const result = await bc.getTransaction(txHash, startHeight)

    expect(result).toBeNull()
    // Fallback window is the full default maxBlocks (30): startHeight .. startHeight+29.
    expect(mockBlock).toHaveBeenCalledWith(startHeight)
    expect(mockBlock).toHaveBeenCalledWith(startHeight + 29)
    expect(mockBlock).not.toHaveBeenCalledWith(startHeight + 30)
    expect(mockBlock).toHaveBeenCalledTimes(30)
  })
})
