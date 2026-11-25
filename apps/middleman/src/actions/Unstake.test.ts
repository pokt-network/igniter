jest.mock('server-only', () => ({}))

// The action pulls in graphql/apollo/blocks at module scope for the unrelated
// duration helper; stub those so only the creation path is exercised.
jest.mock('@igniter/graphql', () => ({ unstakeTimeAvgDocument: {} }))
jest.mock('@igniter/ui/graphql/server', () => ({ getServerApolloClient: jest.fn() }))
jest.mock('@igniter/ui/api/blocks', () => ({ getLatestBlock: jest.fn() }))
// The chain id the signature is verified against, and the LCD the account number is read from.
const CHAIN_ID = 'pocket'
const ACCOUNT_NUMBER = 42
const getApplicationSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: () => getApplicationSettings() }))
const fetchMock = jest.fn()

jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))

const requireAuth = jest.fn()
jest.mock('@/lib/utils/actions', () => ({ requireAuth: () => requireAuth() }))

const insert = jest.fn()
jest.mock('@/lib/dal/transaction', () => ({ insert: (v: unknown) => insert(v) }))

// The caller's nodes: address → { ownerAddress, createdBy }.
let nodes: Record<string, { ownerAddress: string; createdBy: string }> = {}
const sumStakeAmountByAddresses = jest.fn()
jest.mock('@/lib/dal/nodes', () => ({
  sumStakeAmountByAddresses: (a: unknown, o: unknown) => sumStakeAmountByAddresses(a, o),
  getNodeOwnership: async (addresses: string[]) =>
    addresses.filter((address) => nodes[address]).map((address) => ({ address, ...nodes[address]! })),
}))

import { Ripemd160, Secp256k1, sha256 } from '@cosmjs/crypto'
import { toBech32 } from '@cosmjs/encoding'
import { EncodeObject, GeneratedType, makeAuthInfoBytes, makeSignBytes, makeSignDoc, Registry } from '@cosmjs/proto-signing'
import { TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import { PubKey } from '@igniter/pocket/proto/cosmos/crypto/secp256k1/keys'
import { MsgStakeSupplier, MsgUnstakeSupplier } from '@igniter/pocket/proto/pocket/supplier/tx'
import { extractTransactionUnstakingSuppliers } from '@igniter/commons/transactions/extractSuppliers'
import { CreateUnstakeTransaction } from './Unstake'
import { TransactionType } from '@igniter/db/middleman/enums'

const UNSTAKE_TYPE_URL = '/pocket.supplier.MsgUnstakeSupplier'
const registry = new Registry([
  ['/pocket.supplier.MsgStakeSupplier', MsgStakeSupplier as unknown as GeneratedType],
  [UNSTAKE_TYPE_URL, MsgUnstakeSupplier as unknown as GeneratedType],
])

const addressOf = (seed: number) => toBech32('pokt', new Uint8Array(20).fill(seed))
const OP_A = addressOf(7)
const OP_B = addressOf(8)
const OTHER_OWNER = addressOf(9)

type Key = { privkey: Uint8Array; pubkey: Uint8Array }
let ownerKey: Key
let otherKey: Key
let OWNER: string

const makeKey = async (seed: number): Promise<Key> => {
  const keypair = await Secp256k1.makeKeypair(new Uint8Array(32).fill(seed))
  return { privkey: keypair.privkey, pubkey: Secp256k1.compressPubkey(keypair.pubkey) }
}

beforeAll(async () => {
  ownerKey = await makeKey(1)
  otherKey = await makeKey(2)
  OWNER = toBech32('pokt', new Ripemd160().update(sha256(ownerKey.pubkey)).digest())
})

const unstakeMsg = (operator: string, signer = OWNER): EncodeObject => ({
  typeUrl: UNSTAKE_TYPE_URL,
  value: MsgUnstakeSupplier.fromPartial({ signer, operatorAddress: operator }),
})

type SignOptions = {
  /** The key the signature is made with (default: the owner's). */
  key?: Key
  /** The public key the tx names (default: the signing key's); null leaves it out. */
  pubkey?: Uint8Array | null
  chainId?: string
  accountNumber?: number
  /** A signature that is not over this tx. */
  junkSignature?: boolean
}

/** A TxRaw hex signed for real over its SIGN_MODE_DIRECT SignDoc, as both wallets sign. */
async function signedHex(messages: EncodeObject[], options: SignOptions = {}): Promise<string> {
  const key = options.key ?? ownerKey
  const pubkey = options.pubkey === undefined ? key.pubkey : options.pubkey
  const bodyBytes = registry.encodeTxBody({ messages, memo: '' })
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: pubkey ? { typeUrl: '/cosmos.crypto.secp256k1.PubKey', value: PubKey.encode({ key: pubkey }).finish() } : undefined, sequence: 3 }] as Parameters<typeof makeAuthInfoBytes>[0],
    [{ denom: 'upokt', amount: '10' }],
    200000,
    undefined,
    undefined,
  )
  const signDoc = makeSignDoc(bodyBytes, authInfoBytes, options.chainId ?? CHAIN_ID, options.accountNumber ?? ACCOUNT_NUMBER)
  const signed = await Secp256k1.createSignature(sha256(makeSignBytes(signDoc)), key.privkey)
  const signature = options.junkSignature ? new Uint8Array(64).fill(7) : new Uint8Array([...signed.r(32), ...signed.s(32)])
  return Buffer.from(TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [signature] })).finish()).toString('hex')
}

/** A client unsigned payload naming other operators than the signed bytes. */
const lyingPayload = (...operators: string[]) => JSON.stringify({
  body: { messages: operators.map((operatorAddress) => ({ typeUrl: UNSTAKE_TYPE_URL, value: { operatorAddress, signer: OWNER } })) },
})

const request = (signedPayload: string, unsignedPayload = '{"body":{"messages":[]}}', address = OWNER) => ({
  transaction: { address, signedPayload, unsignedPayload, estimatedFee: 10 },
}) as unknown as Parameters<typeof CreateUnstakeTransaction>[0]

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  getApplicationSettings.mockResolvedValue({ chainId: CHAIN_ID, pocketApiUrl: 'https://api.example' })
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account: { account_number: String(ACCOUNT_NUMBER), sequence: '3' } }) })
  requireAuth.mockResolvedValue('pokt1caller')
  insert.mockImplementation(async (v) => ({ id: 1, ...(v as object) }))
  sumStakeAmountByAddresses.mockResolvedValue('9300000000000')
  nodes = {
    [OP_A]: { ownerAddress: OWNER, createdBy: 'pokt1caller' },
    [OP_B]: { ownerAddress: OWNER, createdBy: 'pokt1caller' },
  }
})

describe('CreateUnstakeTransaction payload validation', () => {
  it('rejects an empty signed payload without creating a row', async () => {
    // tx 519 on mainnet: the wallet returned the body but no signed bytes, the row was stored
    // with signedPayload '' and could never be broadcast.
    await expect(CreateUnstakeTransaction(request(''))).rejects.toThrow('no signed transaction')
    expect(insert).not.toHaveBeenCalled()
  })

  it("stores the messages decoded from the signed bytes, not the client's unsigned copy", async () => {
    await CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)]), lyingPayload(OP_B)))

    const stored = insert.mock.calls[0]![0] as { unsignedPayload: string }
    expect(extractTransactionUnstakingSuppliers(stored).map((s) => s.operatorAddress)).toEqual([OP_A])
  })

  it('rejects a signed transaction that is not an unstake', async () => {
    const stake: EncodeObject = {
      typeUrl: '/pocket.supplier.MsgStakeSupplier',
      value: MsgStakeSupplier.fromPartial({ signer: OWNER, ownerAddress: OWNER, operatorAddress: OP_A, services: [] }),
    }
    await expect(CreateUnstakeTransaction(request(await signedHex([stake])))).rejects.toThrow('Unsupported message type')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a signer that is not the transaction sender', async () => {
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A, OTHER_OWNER)])))).rejects.toThrow('not signed by the transaction sender')
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)]), undefined, OTHER_OWNER))).rejects.toThrow('not signed by the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('CreateUnstakeTransaction ownership (only the owner can unstake, as on chain)', () => {
  it('accepts an unstake of the caller’s nodes signed by their owner', async () => {
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A), unstakeMsg(OP_B)])))).resolves.toBeTruthy()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: TransactionType.Unstake, fromAddress: OWNER }))
  })

  it('rejects when the signer is not the owner of every supplier', async () => {
    nodes[OP_B] = { ownerAddress: OTHER_OWNER, createdBy: 'pokt1caller' }
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A), unstakeMsg(OP_B)])))).rejects.toThrow('owner of every supplier')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a supplier the caller did not create', async () => {
    nodes[OP_B] = { ownerAddress: OWNER, createdBy: 'pokt1someoneelse' }
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A), unstakeMsg(OP_B)])))).rejects.toThrow('not yours')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a supplier middleman does not know', async () => {
    delete nodes[OP_B]
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A), unstakeMsg(OP_B)])))).rejects.toThrow('not yours')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('CreateUnstakeTransaction amount derivation', () => {
  it('stores the derived amount on the transaction', async () => {
    // The whole point of #335: without this the row is created with a null
    // amount and "Total POKT" falls back to the payload sum, which is 0.
    await CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A), unstakeMsg(OP_B)])))

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: TransactionType.Unstake, amount: '9300000000000' }),
    )
  })

  it('derives from the signed operators, scoped to the authenticated caller', async () => {
    await CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A), unstakeMsg(OP_B)]), lyingPayload(addressOf(3))))

    expect(sumStakeAmountByAddresses).toHaveBeenCalledWith([OP_A, OP_B], { createdBy: 'pokt1caller' })
  })

  it('still creates the transaction when the amount cannot be derived', async () => {
    // A display-only value must never cost the user an already-signed tx.
    sumStakeAmountByAddresses.mockRejectedValue(new Error('db down'))

    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)])))).resolves.toBeTruthy()

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ amount: null }))
  })

  it('stores null when no supplier stake could be vouched for', async () => {
    sumStakeAmountByAddresses.mockResolvedValue(null)

    await CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)])))

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ amount: null }))
  })
})

describe('CreateUnstakeTransaction signature verification', () => {
  it('accepts a really signed unstake and stores the address of the signing key', async () => {
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)])))).resolves.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example/cosmos/auth/v1beta1/accounts/${OWNER}`, expect.objectContaining({ signal: expect.anything() }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ fromAddress: OWNER }))
  })

  it('rejects a transaction without a signer public key', async () => {
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)], { pubkey: null })))).rejects.toThrow('no signer public key')
    expect(insert).not.toHaveBeenCalled()
  })

  it("rejects another account's public key with a signature that key did not make", async () => {
    // The owner of OP_A did not sign: the request names the owner's key with another key's signature.
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)], { junkSignature: true })))).rejects.toThrow('signature is not valid')
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)], { key: otherKey, pubkey: ownerKey.pubkey })))).rejects.toThrow('signature is not valid')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a correct signature over another chain id', async () => {
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)], { chainId: 'pocket-beta' })))).rejects.toThrow('signature is not valid')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a correct signature over another account number', async () => {
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)], { accountNumber: ACCOUNT_NUMBER + 1 })))).rejects.toThrow('signature is not valid')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a client address that is not the address of the signing key', async () => {
    const other = toBech32('pokt', new Ripemd160().update(sha256(otherKey.pubkey)).digest())
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)]), undefined, other))).rejects.toThrow('not signed by the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses, never skips the check, when the account cannot be read from chain', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' })
    await expect(CreateUnstakeTransaction(request(await signedHex([unstakeMsg(OP_A)])))).rejects.toThrow('Fetch account sequence failed (404)')
    expect(insert).not.toHaveBeenCalled()
  })
})
