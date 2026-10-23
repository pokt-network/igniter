jest.mock('server-only', () => ({}))

// The action module pulls in provider listing and crypto for the unrelated offer/memo helpers;
// stub those so only the creation path is exercised.
jest.mock('@/actions/ApplicationSettings', () => ({ getApplicationSettings: jest.fn() }))
jest.mock('@/actions/Providers', () => ({ ListProviders: jest.fn() }))
jest.mock('@igniter/commons/crypto', () => ({
  getCompressedPublicKeyFromAppIdentity: jest.fn(),
  signPayload: jest.fn(),
}))

jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))

const requireAuth = jest.fn()
jest.mock('@/lib/utils/actions', () => ({ requireAuth: () => requireAuth() }))

const insert = jest.fn()
jest.mock('@/lib/dal/transaction', () => ({ insert: (v: unknown) => insert(v) }))

import { CreateStakeTransaction } from './Stake'
import { TransactionType } from '@igniter/db/middleman/enums'

const request = (signedPayload: string, unsignedPayload = '{"body":{"messages":[]}}') => ({
  offer: { identity: 'provider-1', fee: '5', feeType: 'up_to' },
  transaction: {
    address: 'pokt1owner',
    signedPayload,
    unsignedPayload,
    estimatedFee: 10,
  },
}) as unknown as Parameters<typeof CreateStakeTransaction>[0]

beforeEach(() => {
  jest.clearAllMocks()
  requireAuth.mockResolvedValue('pokt1caller')
  insert.mockImplementation(async (v) => ({ id: 1, ...(v as object) }))
})

describe('CreateStakeTransaction payload validation', () => {
  it('creates the row for a signed transaction', async () => {
    await CreateStakeTransaction(request('abcd'))

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: TransactionType.Stake, signedPayload: 'abcd' }))
  })

  it('rejects an empty signed payload without creating a row', async () => {
    await expect(CreateStakeTransaction(request(''))).rejects.toThrow('no signed transaction')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects an empty unsigned payload without creating a row', async () => {
    await expect(CreateStakeTransaction(request('abcd', ''))).rejects.toThrow('no transaction body')
    expect(insert).not.toHaveBeenCalled()
  })
})
