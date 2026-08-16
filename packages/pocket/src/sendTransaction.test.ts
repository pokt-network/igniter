// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockBroadcastTxSync = jest.fn()
const mockGetHeight = jest.fn()
const mockDisconnect = jest.fn()
const mockStatus = jest.fn()

jest.mock('@cosmjs/stargate', () => {
  const actual = jest.requireActual('@cosmjs/stargate')
  return {
    ...actual,
    StargateClient: {
      create: jest.fn().mockResolvedValue({
        broadcastTxSync: mockBroadcastTxSync,
        getHeight: mockGetHeight,
        disconnect: mockDisconnect,
      }),
    },
  }
})

jest.mock('@cosmjs/tendermint-rpc', () => ({
  connectComet: jest.fn().mockResolvedValue({
    status: mockStatus,
    disconnect: mockDisconnect,
  }),
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
import { BroadcastTxError, TimeoutError } from '@cosmjs/stargate'
import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { createHash } from 'node:crypto'

// Any hex blob works: sendTransaction broadcasts the bytes without decoding them.
const SIGNED_PAYLOAD = 'deadbeef'.repeat(8)
const EXPECTED_LOCAL_HASH = toHex(sha256(Uint8Array.from(Buffer.from(SIGNED_PAYLOAD, 'hex')))).toUpperCase()

async function createInstance() {
  return PocketBlockchain.setup('http://localhost:26657', 'upokt', 0.001)
}

/**
 * #339: a broadcast error is not evidence the tx failed. Only a hard CheckTx rejection proves
 * the tx can never land; every other error leaves the outcome unknown, and the caller needs a
 * hash to hand the tx to the verifier. These tests pin that discrimination.
 */
describe('PocketBlockchain.sendTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('success: returns the node-reported hash and rejected=false', async () => {
    const nodeHash = 'ABCD1234'.repeat(8)
    mockBroadcastTxSync.mockResolvedValue(nodeHash)

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.success).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.transactionHash).toBe(nodeHash)
  })

  it('BroadcastTxError: rejected=true (hard CheckTx rejection — tx can never land)', async () => {
    mockBroadcastTxSync.mockRejectedValue(new BroadcastTxError(11, 'sdk', 'out of gas in ante handler'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(true)
    expect(result.code).toBe(11)
    expect(result.codespace).toBe('sdk')
    expect(result.message).toContain('out of gas')
  })

  it('code 32 (wrong sequence): NOT rejected — the tx may already have landed', async () => {
    // CheckTx answers 32 both when the sequence is already consumed (the tx landed) and when a
    // predecessor is still in the mempool (this one lands next). Writing Failure here would
    // recreate #339 inside its own fix, and would release the provider's addresses.
    mockBroadcastTxSync.mockRejectedValue(new BroadcastTxError(32, 'sdk', 'account sequence mismatch'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(false)
    expect(result.code).toBe(32)
    expect(result.transactionHash).toBe(EXPECTED_LOCAL_HASH)
  })

  it('code 20 (mempool full): NOT rejected — the bytes are still valid', async () => {
    mockBroadcastTxSync.mockRejectedValue(new BroadcastTxError(20, 'sdk', 'mempool is full'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.rejected).toBe(false)
    expect(result.code).toBe(20)
  })

  it('rejects a payload that is not valid hex instead of hashing empty bytes', async () => {
    const bc = await createInstance()

    // Buffer.from(x,'hex') truncates at the first invalid char; an empty result would write
    // sha256('') as the hash of every malformed tx.
    await expect(bc.sendTransaction('nothex!!')).rejects.toThrow(/not valid hex/)
    expect(mockBroadcastTxSync).not.toHaveBeenCalled()
  })

  it('TimeoutError: rejected=false and the locally derived hash is returned', async () => {
    mockBroadcastTxSync.mockRejectedValue(new TimeoutError('timeout waiting for commit', 'DEADBEEF'.repeat(8)))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(false)
    expect(result.isTimeout).toBe(true)
    expect(result.transactionHash).toBe(EXPECTED_LOCAL_HASH)
  })

  it('transport failure (socket reset): rejected=false and the hash still comes back', async () => {
    mockBroadcastTxSync.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(false)
    expect(result.transactionHash).toBe(EXPECTED_LOCAL_HASH)
    // A string errno must never masquerade as a chain error code.
    expect(result.code).toBeUndefined()
  })

  it('unordered dedup: an "already in mempool" rejection is success, not failure', async () => {
    mockBroadcastTxSync.mockRejectedValue(
      Object.assign(new Error('tx already exists in cache'), { code: 19, codespace: 'sdk' }),
    )

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.success).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.transactionHash).toBe(EXPECTED_LOCAL_HASH)
    expect(result.message).toBe('already broadcast (unordered dedup)')
  })

  it('code 32 in a NON-sdk codespace is still a hard rejection', async () => {
    // Cosmos error codes are codespace-scoped: a module error reusing the number 32 has nothing
    // to do with ErrWrongSequence and must not inherit the indeterminate treatment.
    mockBroadcastTxSync.mockRejectedValue(new BroadcastTxError(32, 'supplier', 'module-specific failure'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.rejected).toBe(true)
  })

  it('RPC unreachable: neverSent=true so the caller can safely retry', async () => {
    const bc = await createInstance()
    // Connection setup fails — no bytes are transmitted, which is the one error class that is
    // provably safe to retry (and to roll a pre-broadcast anchor back for).
    jest.spyOn(bc as unknown as { getStargateClient: () => Promise<unknown> }, 'getStargateClient')
      .mockRejectedValue(new Error('Failed to connect to the blockchain.'))

    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.neverSent).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.success).toBe(false)
    expect(mockBroadcastTxSync).not.toHaveBeenCalled()
  })

  it('a broadcast that DID happen is never marked neverSent', async () => {
    mockBroadcastTxSync.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    // The bytes may have reached the node, so this must NOT look retry-safe.
    expect(result.neverSent).toBeUndefined()
  })

  it('the derived hash matches an independently computed sha256 (not just our own expression)', async () => {
    // Computed with node:crypto rather than @cosmjs/crypto, so this cannot pass by echoing the
    // implementation's own derivation back at itself.
    const independent = createHash('sha256')
      .update(Buffer.from(SIGNED_PAYLOAD, 'hex'))
      .digest('hex')
      .toUpperCase()

    mockBroadcastTxSync.mockRejectedValue(new Error('no answer'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.transactionHash).toBe(independent)
  })

  it('hashes exactly the bytes it broadcasts', async () => {
    // The invariant the anchor rests on. `deriveTxHash(payload)` and `Buffer.from(payload,'hex')`
    // are two independent decodes of the same string: if they ever diverge, every anchored hash
    // matches nothing on chain and the verifier drives every tx to Failure after the bound —
    // #339 again, with a worse failure mode. Assert against the bytes actually handed to cosmjs.
    mockBroadcastTxSync.mockRejectedValue(new Error('no answer'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    const broadcastBytes = mockBroadcastTxSync.mock.calls[0]![0] as Uint8Array
    expect(toHex(sha256(broadcastBytes)).toUpperCase()).toBe(result.transactionHash)
  })

  it('rejects an odd-length payload (silent truncation would change the bytes)', async () => {
    const bc = await createInstance()

    await expect(bc.sendTransaction('deadbee')).rejects.toThrow(/not valid hex/)
    expect(mockBroadcastTxSync).not.toHaveBeenCalled()
  })

  it('rejects an empty payload rather than hashing zero bytes', async () => {
    const bc = await createInstance()

    // sha256('') is a constant — without this guard it would be written as the hash of every
    // malformed transaction, colliding unrelated rows on one anchor.
    await expect(bc.sendTransaction('')).rejects.toThrow(/not valid hex/)
    expect(mockBroadcastTxSync).not.toHaveBeenCalled()
  })

  it('the node-reported hash and the locally derived hash agree', async () => {
    // The invariant the whole design rests on: what CometBFT returns from broadcast_tx_sync is
    // sha256 of the same bytes we hashed, so an anchor written before broadcasting is the hash
    // the chain will know the tx by.
    mockBroadcastTxSync.mockResolvedValue(EXPECTED_LOCAL_HASH)

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    expect(result.transactionHash).toBe(EXPECTED_LOCAL_HASH)
  })

  it('the derived hash matches the block-scan derivation (sha256 of the broadcast bytes)', async () => {
    mockBroadcastTxSync.mockRejectedValue(new Error('no answer'))

    const bc = await createInstance()
    const result = await bc.sendTransaction(SIGNED_PAYLOAD)

    // Same derivation matchTxInBlock uses to match a tx while scanning a block, so a hash
    // produced here is findable on-chain by the verifier.
    expect(result.transactionHash).toMatch(/^[0-9A-F]{64}$/)
    expect(result.transactionHash).toBe(EXPECTED_LOCAL_HASH)
  })
})
