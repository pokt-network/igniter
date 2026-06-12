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

const txContent = Buffer.from('some-tx-content')
const txHashBytes = sha256(txContent)
const txHash = toHex(txHashBytes).toUpperCase()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PocketBlockchain.verifyTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetHeight.mockResolvedValue(10_000_000)
  })

  // confirmed: Tier 1 hit short-circuits.
  it('confirmed when the hash is found in the window (Tier 1 hit)', async () => {
    mockGetTx.mockResolvedValue({
      hash: txHash,
      height: 1000,
      txIndex: 0,
      gasUsed: BigInt(50000),
      gasWanted: BigInt(100000),
      code: 0,
    })

    const bc = await createInstance('http://api.example.com')
    const r = await bc.verifyTransaction(txHash, 1000, 30)

    expect(r.status).toBe('confirmed')
    if (r.status === 'confirmed') {
      expect(r.data).toEqual({
        hash: txHash,
        height: 1000,
        index: 0,
        gasUsed: BigInt(50000),
        gasWanted: BigInt(100000),
        success: true,
        code: 0,
      })
    }
    // Tier 3 should be skipped on a direct hit.
    expect(mockBlock).not.toHaveBeenCalled()
  })

  // absent: full (head-capped) window scanned, tx not present.
  it('absent with coveredUpToHeight when window fully scanned, not found', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })
    mockBlock.mockResolvedValue({ block: { txs: [] } }) // tx never present
    mockGetHeight.mockResolvedValue(1005) // head caps the window at 1005

    const bc = await createInstance('http://api.example.com')
    const r = await bc.verifyTransaction(txHash, 1000, 30)

    expect(r).toEqual({ status: 'absent', coveredUpToHeight: 1005 })
  })

  // unavailable: getHeight throws → cannot determine the window.
  it('unavailable when getHeight throws (cannot determine the window)', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })
    mockGetHeight.mockRejectedValue(new Error('rpc unreachable'))

    const bc = await createInstance('http://api.example.com')
    const r = await bc.verifyTransaction(txHash, 1000, 30)

    expect(r.status).toBe('unavailable')
  })

  // unavailable: a block fetch errors → could not cover the window.
  it('unavailable when a block fetch errors (could not cover the window)', async () => {
    mockGetTx.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false })
    mockGetHeight.mockResolvedValue(1005)
    mockBlock.mockRejectedValue(new Error('block fetch failed'))

    const bc = await createInstance('http://api.example.com')
    const r = await bc.verifyTransaction(txHash, 1000, 30)

    expect(r.status).toBe('unavailable')
  })

  it('falls through to the block scan when Tier-1 getTx throws (tx indexing disabled)', async () => {
    // Tier 1 rejects with "transaction indexing is disabled"
    mockGetTx.mockRejectedValue(new Error('transaction indexing is disabled'))
    // REST is disabled too
    mockFetch.mockResolvedValue({ ok: false })
    // head is beyond the window
    mockGetHeight.mockResolvedValue(1005)
    // The tx IS in block 1000
    mockBlock.mockImplementation((h: number) => {
      if (h === 1000) {
        return Promise.resolve({ block: { txs: [txContent] } })
      }
      return Promise.resolve({ block: { txs: [] } })
    })
    mockBlockResults.mockResolvedValue({
      results: [{ code: 0, gasUsed: BigInt(50000), gasWanted: BigInt(100000) }],
    })

    const bc = await createInstance('http://api.example.com')
    const r = await bc.verifyTransaction(txHash, 1000, 30)

    expect(r.status).toBe('confirmed')
  })

  it('returns absent with coveredUpToHeight = startHeight - 1 when caught up to head', async () => {
    // getTx returns null (no direct hit)
    mockGetTx.mockResolvedValue(null)
    // REST disabled
    mockFetch.mockResolvedValue({ ok: false })
    // head is startHeight - 1 (node has not produced any new blocks yet)
    mockGetHeight.mockResolvedValue(999) // startHeight=1000, so head < startHeight

    const bc = await createInstance('http://api.example.com')
    const r = await bc.verifyTransaction(txHash, 1000, 30)

    expect(r).toEqual({ status: 'absent', coveredUpToHeight: 999 })
  })
})
