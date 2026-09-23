jest.mock('server-only', () => ({}))

// The action pulls in graphql/apollo/blocks at module scope for the unrelated
// duration helper; stub those so only the creation path is exercised.
jest.mock('@igniter/graphql', () => ({ unstakeTimeAvgDocument: {} }))
jest.mock('@igniter/ui/graphql/server', () => ({ getServerApolloClient: jest.fn() }))
jest.mock('@igniter/ui/api/blocks', () => ({ getLatestBlock: jest.fn() }))
jest.mock('@/actions/ApplicationSettings', () => ({ getApplicationSettings: jest.fn() }))

jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))

const requireAuth = jest.fn()
jest.mock('@/lib/utils/actions', () => ({ requireAuth: () => requireAuth() }))

const insert = jest.fn()
jest.mock('@/lib/dal/transaction', () => ({ insert: (v: unknown) => insert(v) }))

const sumStakeAmountByAddresses = jest.fn()
jest.mock('@/lib/dal/nodes', () => ({
  sumStakeAmountByAddresses: (a: unknown, o: unknown) => sumStakeAmountByAddresses(a, o),
}))

import { CreateUnstakeTransaction } from './Unstake'
import { TransactionType } from '@igniter/db/middleman/enums'

const UNSTAKE_TYPE_URL = '/pocket.supplier.MsgUnstakeSupplier'

const payload = (...operators: string[]) => JSON.stringify({
  body: {
    messages: operators.map((operatorAddress) => ({
      typeUrl: UNSTAKE_TYPE_URL,
      value: { operatorAddress, signer: 'pokt1owner' },
    })),
  },
})

const request = (unsignedPayload: string) => ({
  transaction: {
    address: 'pokt1owner',
    signedPayload: 'signed',
    unsignedPayload,
    estimatedFee: 10,
  },
}) as unknown as Parameters<typeof CreateUnstakeTransaction>[0]

beforeEach(() => {
  jest.clearAllMocks()
  requireAuth.mockResolvedValue('pokt1caller')
  insert.mockImplementation(async (v) => ({ id: 1, ...(v as object) }))
  sumStakeAmountByAddresses.mockResolvedValue('9300000000000')
})

describe('CreateUnstakeTransaction amount derivation', () => {
  it('stores the derived amount on the transaction', async () => {
    // The whole point of #335: without this the row is created with a null
    // amount and "Total POKT" falls back to the payload sum, which is 0.
    await CreateUnstakeTransaction(request(payload('pokt1a', 'pokt1b')))

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: TransactionType.Unstake, amount: '9300000000000' }),
    )
  })

  it('derives from the payload operators, scoped to the authenticated caller', async () => {
    // The payload is client-supplied, so the sum must be scoped to the session
    // identity -- never to anything taken from the request.
    await CreateUnstakeTransaction(request(payload('pokt1a', 'pokt1b')))

    expect(sumStakeAmountByAddresses).toHaveBeenCalledWith(
      ['pokt1a', 'pokt1b'],
      { createdBy: 'pokt1caller' },
    )
  })

  it('still creates the transaction when the amount cannot be derived', async () => {
    // A display-only value must never cost the user an already-signed tx.
    sumStakeAmountByAddresses.mockRejectedValue(new Error('db down'))

    await expect(CreateUnstakeTransaction(request(payload('pokt1a')))).resolves.toBeTruthy()

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ amount: null }))
  })

  it('stores null when no supplier stake could be vouched for', async () => {
    sumStakeAmountByAddresses.mockResolvedValue(null)

    await CreateUnstakeTransaction(request(payload('pokt1a')))

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ amount: null }))
  })

  it('does not blow up on a malformed payload', async () => {
    await expect(CreateUnstakeTransaction(request('not-json'))).resolves.toBeTruthy()

    expect(sumStakeAmountByAddresses).toHaveBeenCalledWith([], { createdBy: 'pokt1caller' })
  })
})
