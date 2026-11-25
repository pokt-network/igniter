jest.mock('server-only', () => ({}))

// The action module pulls in provider listing and crypto for the unrelated offer/memo helpers;
// stub those so only the creation path is exercised.
jest.mock('@/actions/ApplicationSettings', () => ({ getApplicationSettings: jest.fn() }))
const getProviderByIdentity = jest.fn()
jest.mock('@/lib/dal/providers', () => ({
  list: jest.fn(),
  getByIdentity: (identity: string) => getProviderByIdentity(identity),
}))
jest.mock('@igniter/commons/crypto', () => ({
  getCompressedPublicKeyFromAppIdentity: jest.fn(),
  signPayload: jest.fn(),
}))

jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))

const requireAuth = jest.fn()
jest.mock('@/lib/utils/actions', () => ({ requireAuth: () => requireAuth() }))

const resolveGovernance = jest.fn()
jest.mock('@/lib/governance', () => ({ governance: { resolve: (identity: string) => resolveGovernance(identity) } }))

const insert = jest.fn()
jest.mock('@/lib/dal/transaction', () => ({ insert: (v: unknown) => insert(v) }))

// The chain id the signature is verified against, and the LCD the account number is read from.
const CHAIN_ID = 'pocket'
const ACCOUNT_NUMBER = 42
const getServerSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: () => getServerSettings() }))
const fetchMock = jest.fn()

import { Ripemd160, Secp256k1, sha256 } from '@cosmjs/crypto'
import { toBech32 } from '@cosmjs/encoding'
import { EncodeObject, GeneratedType, makeAuthInfoBytes, makeSignBytes, makeSignDoc, Registry } from '@cosmjs/proto-signing'
import { TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import { PubKey } from '@igniter/pocket/proto/cosmos/crypto/secp256k1/keys'
import { MsgStakeSupplier, MsgUnstakeSupplier } from '@igniter/pocket/proto/pocket/supplier/tx'
import { MsgSend } from '@igniter/pocket/proto/cosmos/bank/v1beta1/tx'
import { CreateStakeTransaction } from './Stake'
import { ProviderFee, TransactionType } from '@igniter/db/middleman/enums'
import { extractTransactionStakingSuppliers } from '@igniter/commons/transactions/extractSuppliers'

const registry = new Registry([
  ['/cosmos.bank.v1beta1.MsgSend', MsgSend as unknown as GeneratedType],
  ['/pocket.supplier.MsgStakeSupplier', MsgStakeSupplier as unknown as GeneratedType],
  ['/pocket.supplier.MsgUnstakeSupplier', MsgUnstakeSupplier as unknown as GeneratedType],
])

const addressOf = (seed: number) => toBech32('pokt', new Uint8Array(20).fill(seed))
const OPERATOR = addressOf(7)
const OTHER_OPERATOR = addressOf(8)

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

const stakeMsg = (owner: string, operator: string, signer = owner): EncodeObject => ({
  typeUrl: '/pocket.supplier.MsgStakeSupplier',
  value: MsgStakeSupplier.fromPartial({
    signer,
    ownerAddress: owner,
    operatorAddress: operator,
    stake: { denom: 'upokt', amount: '60000000000' },
    services: [],
  }),
})

const sendMsg = (from: string, to: string): EncodeObject => ({
  typeUrl: '/cosmos.bank.v1beta1.MsgSend',
  value: MsgSend.fromPartial({ fromAddress: from, toAddress: to, amount: [{ denom: 'upokt', amount: '1000000' }] }),
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

const request = (signedPayload: string, unsignedPayload = '{"body":{"messages":[]}}', address = OWNER) => ({
  offer: { identity: 'provider-1', fee: '99', feeType: ProviderFee.Fixed },
  transaction: {
    address,
    signedPayload,
    unsignedPayload,
    estimatedFee: 10,
  },
}) as unknown as Parameters<typeof CreateStakeTransaction>[0]

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  getServerSettings.mockResolvedValue({ chainId: CHAIN_ID, pocketApiUrl: 'https://api.example' })
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account: { account_number: String(ACCOUNT_NUMBER), sequence: '3' } }) })
  requireAuth.mockResolvedValue('pokt1caller')
  insert.mockImplementation(async (v) => ({ id: 1, ...(v as object) }))
  resolveGovernance.mockImplementation(async (identity: string) => ({ identity, url: 'https://provider.example' }))
  getProviderByIdentity.mockResolvedValue({ identity: 'provider-1', fee: 5, feeType: ProviderFee.UpTo })
})

describe('CreateStakeTransaction provider check', () => {
  it('rejects a provider identity the governance source does not list, without creating a row', async () => {
    resolveGovernance.mockResolvedValue(null)
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)])))).rejects.toThrow('not in the governance source')
    expect(resolveGovernance).toHaveBeenCalledWith('provider-1')
    expect(insert).not.toHaveBeenCalled()
  })

  it("stores the provider's fee from its row, not the offer the client sends", async () => {
    await CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)])))
    expect(getProviderByIdentity).toHaveBeenCalledWith('provider-1')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-1',
      providerFee: 5,
      typeProviderFee: ProviderFee.UpTo,
    }))
  })

  it('rejects a provider without a row, without creating a row', async () => {
    getProviderByIdentity.mockResolvedValue(undefined)
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)])))).rejects.toThrow('not available')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('CreateStakeTransaction payload validation', () => {
  it('creates the row for a signed transaction', async () => {
    const hex = await signedHex([stakeMsg(OWNER, OPERATOR), sendMsg(OWNER, OPERATOR)])
    await CreateStakeTransaction(request(hex))

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: TransactionType.Stake, signedPayload: hex, fromAddress: OWNER }))
  })

  it('stores the messages of the signed bytes, not the unsigned payload the client sends', async () => {
    const forged = JSON.stringify({ body: { messages: [stakeMsg(OWNER, OTHER_OPERATOR)] } })
    await CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR), sendMsg(OWNER, OPERATOR)]), forged))

    const stored = insert.mock.calls[0]![0] as { unsignedPayload: string }
    // The workflows read the stored payload with this parser.
    const suppliers = extractTransactionStakingSuppliers(stored)
    expect(suppliers.map((s) => s.address)).toEqual([OPERATOR])
    expect(suppliers[0]).toMatchObject({ ownerAddress: OWNER, stakeAmount: '60000000000', opFundsUpokt: '1000000' })
  })

  it('rejects an empty signed payload without creating a row', async () => {
    await expect(CreateStakeTransaction(request(''))).rejects.toThrow('no signed transaction')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects an empty unsigned payload without creating a row', async () => {
    await expect(CreateStakeTransaction(request('abcd', ''))).rejects.toThrow('no transaction body')
    expect(insert).not.toHaveBeenCalled()
  })

  it.each([
    ['not hex', 'zz'],
    ['odd length hex', 'abc'],
    ['hex that is not a TxRaw', 'ffffffff'],
  ])('rejects a signed payload that is %s', async (_label, payload) => {
    await expect(CreateStakeTransaction(request(payload))).rejects.toThrow()
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a transaction without a stake message', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([sendMsg(OWNER, OPERATOR)])))).rejects.toThrow('no stake message')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a message type a stake does not carry', async () => {
    const unstake: EncodeObject = {
      typeUrl: '/pocket.supplier.MsgUnstakeSupplier',
      value: MsgUnstakeSupplier.fromPartial({ signer: OWNER, operatorAddress: OTHER_OPERATOR }),
    }
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR), unstake])))).rejects.toThrow('Unsupported message type')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a stake message owned or signed by another address', async () => {
    const other = addressOf(9)
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(other, OPERATOR, OWNER)])))).rejects.toThrow('not signed by the transaction sender')
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR, other)])))).rejects.toThrow('not signed by the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a send from another address', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR), sendMsg(addressOf(9), OPERATOR)])))).rejects.toThrow('not from the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a transaction signed by a key that is not the sender', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)], { key: otherKey })))).rejects.toThrow('not signed by the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a sender address the messages do not belong to', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)]), undefined, addressOf(9)))).rejects.toThrow('not signed by the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('CreateStakeTransaction signature verification', () => {
  it('accepts a really signed stake and stores the address of the signing key', async () => {
    const hex = await signedHex([stakeMsg(OWNER, OPERATOR), sendMsg(OWNER, OPERATOR)])
    await expect(CreateStakeTransaction(request(hex))).resolves.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example/cosmos/auth/v1beta1/accounts/${OWNER}`, expect.objectContaining({ signal: expect.anything() }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ fromAddress: OWNER }))
  })

  it('rejects a transaction without a signer public key', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)], { pubkey: null })))).rejects.toThrow('no signer public key')
    expect(insert).not.toHaveBeenCalled()
  })

  it("rejects another account's public key with a signature that key did not make", async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)], { junkSignature: true })))).rejects.toThrow('signature is not valid')
    // A real signature by a different key, presented with the other account's public key.
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)], { key: otherKey, pubkey: ownerKey.pubkey })))).rejects.toThrow('signature is not valid')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a correct signature over another chain id', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)], { chainId: 'pocket-beta' })))).rejects.toThrow('signature is not valid')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a correct signature over another account number', async () => {
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)], { accountNumber: ACCOUNT_NUMBER + 1 })))).rejects.toThrow('signature is not valid')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a client address that is not the address of the signing key', async () => {
    const other = toBech32('pokt', new Ripemd160().update(sha256(otherKey.pubkey)).digest())
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)]), undefined, other))).rejects.toThrow('not signed by the transaction sender')
    expect(insert).not.toHaveBeenCalled()
  })

  it.each([
    ['the LCD fails', 'Fetch account sequence failed (500)', () => fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })],
    ['the LCD times out', 'timed out', () => fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))],
    ['the account has no account number', 'no valid account number', () => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account: { sequence: '3' } }) })],
  ])('refuses, never skips the check, when %s', async (_label, message, arrange) => {
    arrange()
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)])))).rejects.toThrow(message)
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses when no chain id is configured', async () => {
    getServerSettings.mockResolvedValue({ chainId: '', pocketApiUrl: 'https://api.example' })
    await expect(CreateStakeTransaction(request(await signedHex([stakeMsg(OWNER, OPERATOR)])))).rejects.toThrow('No chain id')
    expect(insert).not.toHaveBeenCalled()
  })
})
