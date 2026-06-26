// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockGetAccount = jest.fn()
const mockGetHeight = jest.fn()
const mockDisconnect = jest.fn()
const mockSimulate = jest.fn()
const mockGetSequence = jest.fn()
const mockGetChainId = jest.fn()
const mockBroadcastTx = jest.fn()
const mockStatus = jest.fn()

// Mock @cosmjs/stargate
jest.mock('@cosmjs/stargate', () => {
  const actual = jest.requireActual('@cosmjs/stargate')
  return {
    ...actual,
    StargateClient: {
      create: jest.fn().mockResolvedValue({
        getAccount: mockGetAccount,
        getHeight: mockGetHeight,
        broadcastTx: mockBroadcastTx,
        disconnect: mockDisconnect,
      }),
    },
    SigningStargateClient: {
      createWithSigner: jest.fn().mockResolvedValue({
        simulate: mockSimulate,
        getSequence: mockGetSequence,
        getChainId: mockGetChainId,
        broadcastTx: mockBroadcastTx,
        disconnect: mockDisconnect,
      }),
    },
  }
})

// Mock @cosmjs/tendermint-rpc
jest.mock('@cosmjs/tendermint-rpc', () => ({
  connectComet: jest.fn().mockResolvedValue({
    status: mockStatus,
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

import { PocketBlockchain } from './index'
import { TxBody, TxRaw } from './proto/generated/cosmos/tx/v1beta1/tx'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import { BroadcastTxError, TimeoutError } from '@cosmjs/stargate'

// Deterministic test private key (valid secp256k1 key)
const TEST_PRIVATE_KEY = 'a'.repeat(64)

async function createInstance() {
  return PocketBlockchain.setup('http://localhost:26657', 'upokt', 0.001)
}

async function getTestSignerAddress(): Promise<string> {
  const pkBytes = Uint8Array.from(Buffer.from(TEST_PRIVATE_KEY, 'hex'))
  const wallet = await DirectSecp256k1Wallet.fromKey(pkBytes, 'pokt')
  const [account] = await wallet.getAccounts()
  return account!.address
}

const STAKE_PARAMS_BASE = {
  signerPrivateKey: TEST_PRIVATE_KEY,
  stake: { denom: 'upokt', amount: '1000000' },
  services: [],
  ownerAddress: '',
}

describe('PocketBlockchain.signSupplierTx', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAccount.mockResolvedValue({ sequence: 5, accountNumber: 1, address: 'pokt1signer', pubkey: null })
    mockGetHeight.mockResolvedValue(100)
    mockGetChainId.mockResolvedValue('pocket-localnet')
    mockSimulate.mockResolvedValue(200000)
    mockGetSequence.mockResolvedValue({ accountNumber: 1, sequence: 5 })
    mockBroadcastTx.mockResolvedValue({ transactionHash: 'ABCD1234'.repeat(8), code: 0, rawLog: '' })
    mockStatus.mockResolvedValue({ syncInfo: { latestBlockTime: new Date() } })
  })

  it('returns a non-empty base64 signedPayload', async () => {
    const signer = await getTestSignerAddress()
    const bc = await createInstance()
    const result = await bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer })

    expect(result.signedPayload).toBeTruthy()
    // valid base64: Buffer.from(base64, 'base64') must round-trip
    const decoded = Buffer.from(result.signedPayload, 'base64')
    expect(decoded.length).toBeGreaterThan(0)
  })

  it('returns transactionHash as 64-char uppercase hex', async () => {
    const signer = await getTestSignerAddress()
    const bc = await createInstance()
    const result = await bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer })

    expect(result.transactionHash).toMatch(/^[0-9A-F]{64}$/)
  })

  it('signedPayload decodes to TxBody with unordered=true', async () => {
    const signer = await getTestSignerAddress()
    const bc = await createInstance()
    const result = await bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer })

    const txBytes = Uint8Array.from(Buffer.from(result.signedPayload, 'base64'))
    const txRaw = TxRaw.decode(txBytes)
    const txBody = TxBody.decode(txRaw.bodyBytes)

    expect(txBody.unordered).toBe(true)
  })

  it('timeoutTimestamp is latest block time + 9 minutes', async () => {
    const latestBlockTime = new Date('2026-06-23T22:23:40.404Z')
    mockStatus.mockResolvedValue({ syncInfo: { latestBlockTime } })

    const signer = await getTestSignerAddress()
    const bc = await createInstance()
    const result = await bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer })

    expect(result.timeoutTimestamp.getTime()).toBe(latestBlockTime.getTime() + 9 * 60 * 1000)
  })

  it('timeoutTimestamp falls back to approximately now + 9 minutes without latest block time', async () => {
    mockStatus.mockRejectedValue(new Error('status unavailable'))
    const signer = await getTestSignerAddress()
    const bc = await createInstance()
    const before = Date.now()
    const result = await bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer })
    const after = Date.now()

    const expectedMs = 9 * 60 * 1000
    const ts = result.timeoutTimestamp.getTime()
    expect(ts).toBeGreaterThanOrEqual(before + expectedMs - 5000)
    expect(ts).toBeLessThanOrEqual(after + expectedMs + 5000)
  })

  it('throws when signerPrivateKey is invalid (wrong length)', async () => {
    const bc = await createInstance()
    // A valid hex string but wrong length (not 32 bytes = 64 hex chars)
    await expect(
      bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer: 'pokt1abc', signerPrivateKey: 'deadbeef' })
    ).rejects.toThrow('Invalid secp256k1 private key')
  })

  it('throws when signer is missing', async () => {
    const bc = await createInstance()
    await expect(
      bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer: '' })
    ).rejects.toThrow('`signer` (bech32) is required')
  })
})

describe('PocketBlockchain.broadcastSupplierTx', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAccount.mockResolvedValue({ sequence: 5, accountNumber: 1, address: 'pokt1signer', pubkey: null })
    mockGetHeight.mockResolvedValue(100)
    mockGetChainId.mockResolvedValue('pocket-localnet')
    mockSimulate.mockResolvedValue(200000)
    mockGetSequence.mockResolvedValue({ accountNumber: 1, sequence: 5 })
    mockBroadcastTx.mockResolvedValue({ transactionHash: 'ABCD1234'.repeat(8), code: 0, rawLog: '' })
    mockStatus.mockResolvedValue({ syncInfo: { latestBlockTime: new Date() } })
  })

  async function getSignedPayload(): Promise<string> {
    const signer = await getTestSignerAddress()
    const bc = await createInstance()
    const result = await bc.signSupplierTx({ ...STAKE_PARAMS_BASE, signer })
    return result.signedPayload
  }

  it('broadcasts successfully and returns success=true', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    mockBroadcastTx.mockResolvedValue({ transactionHash: 'ABCD1234'.repeat(8), code: 0, rawLog: '' })

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(true)
    expect(result.transactionHash).toBeTruthy()
  })

  it('dedup detection: "tx already exists in cache" error is treated as success', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    mockBroadcastTx.mockRejectedValue(
      Object.assign(new Error('tx already exists in cache'), { code: 19, codespace: 'sdk' })
    )

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(true)
    expect(result.transactionHash).toMatch(/^[0-9A-F]{64}$/)
    expect(result.message).toBe('already broadcast (unordered dedup)')
  })

  it('dedup detection: code=18 "failed to add unordered nonce" is treated as success', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    mockBroadcastTx.mockRejectedValue(
      Object.assign(new Error('failed to add unordered nonce: nonce already used'), { code: 18, codespace: 'sdk' })
    )

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(true)
  })

  it('dedup detection: generic code=19 codespace=sdk without dedup message is not treated as success', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    mockBroadcastTx.mockRejectedValue(
      Object.assign(new Error('broadcast tx error'), { code: 19, codespace: 'sdk' })
    )

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(false)
  })

  it('hard reject: returns success=false for non-dedup errors', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    mockBroadcastTx.mockRejectedValue(
      Object.assign(new Error('out of gas'), { code: 11, codespace: 'sdk' })
    )

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(false)
    expect(result.transactionHash).toMatch(/^[0-9A-F]{64}$/)
  })

  it('BroadcastTxError: sets rejected=true (hard CheckTx rejection — tx will never land)', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    mockBroadcastTx.mockRejectedValue(new BroadcastTxError(11, 'sdk', 'out of gas in ante handler'))

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(true)
    expect(result.transactionHash).toMatch(/^[0-9A-F]{64}$/)
  })

  it('TimeoutError: sets rejected=false (RPC timeout — tx may still land on-chain)', async () => {
    const signedPayload = await getSignedPayload()
    jest.clearAllMocks()
    // TimeoutError constructor: (message, txId)
    mockBroadcastTx.mockRejectedValue(new TimeoutError('timeout waiting for commit', 'DEADBEEF'.repeat(8)))

    const bc = await createInstance()
    const result = await bc.broadcastSupplierTx(signedPayload)

    expect(result.success).toBe(false)
    expect(result.rejected).toBe(false)
    expect(result.transactionHash).toMatch(/^[0-9A-F]{64}$/)
  })
})
