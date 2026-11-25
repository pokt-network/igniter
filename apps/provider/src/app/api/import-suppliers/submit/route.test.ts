jest.mock('server-only', () => ({}))

import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'

// The delegator signature and the owner's nonce signature are not under test
// here: both pass, so the tests reach the supplier selection.
jest.mock('@/lib/utils/routes', () => ({
  truncateIdentity: (id: string) => id,
  ensureApplicationIsBootstrapped: async () => undefined,
  validateRequestSignature: async (request: Request) => ({
    delegator: { identity: 'delegator-a', name: 'A' },
    data: await request.json(),
  }),
}))

const OWNER = 'pokt1owner0000000000000000000000000000000'

jest.mock('@igniter/commons/crypto', () => ({
  pubkeyToAddress: () => OWNER,
  verifySignature: async () => true,
}))
jest.mock('@/lib/adr36', () => ({ verifyAdr36Signature: async () => true }))

// One supplier per kind of group.
const SUPPLIERS = [
  { address: 'pokt1open', publicKey: 'p1', addressGroup: { private: false, linkedAddresses: [] } },
  { address: 'pokt1linkedtoowner', publicKey: 'p2', addressGroup: { private: false, linkedAddresses: [OWNER] } },
  { address: 'pokt1nogroup', publicKey: 'p3', addressGroup: null },
  { address: 'pokt1private', publicKey: 'p4', addressGroup: { private: true, linkedAddresses: [] } },
  { address: 'pokt1linkedtoother', publicKey: 'p5', addressGroup: { private: false, linkedAddresses: ['pokt1other'] } },
]
const OPEN_ADDRESSES = ['pokt1open', 'pokt1linkedtoowner', 'pokt1nogroup']

const findSuppliersByOwner = jest.fn()
const assignSuppliersToDelegate = jest.fn(async (addresses: string[]) =>
  addresses.map((address) => ({ address, publicKey: 'pk', stakeAmountUpokt: 0n, services: [] })))
const createImportRequest = jest.fn(async () => ({ id: 1, nonce: 'n', expiresAt: new Date() }))
const markRequestFailed = jest.fn()
jest.mock('@/lib/dal/importSupplierRequests', () => ({
  findSuppliersByOwner: (...args: unknown[]) => findSuppliersByOwner(...args),
  assignSuppliersToDelegate: (...args: [string[]]) => assignSuppliersToDelegate(...args),
  createImportRequest: (...args: unknown[]) => createImportRequest(...(args as [])),
  cancelPendingRequests: async () => 0,
  findPendingRequest: async () => ({ id: 1, nonce: 'nonce' }),
  isRequestExpired: () => false,
  markRequestCompleted: async () => undefined,
  markRequestExpired: async () => undefined,
  markRequestFailed: (...args: unknown[]) => markRequestFailed(...args),
}))

import { POST as submitPOST } from './route'
import { POST as requestPOST } from '../request/route'

function post(handler: (request: Request) => Promise<Response>, payload: unknown) {
  return handler(new Request('http://localhost/api/import-suppliers/x', {
    method: 'POST',
    headers: { [REQUEST_IDENTITY_HEADER]: 'delegator-a' },
    body: JSON.stringify(payload),
  }))
}

const SUBMIT_BODY = {
  ownerAddress: OWNER,
  ownerPublicKey: '02' + 'a'.repeat(64),
  signedNonce: 'sig',
  delegatorAddress: 'pokt1delegator',
  revSharePercentage: 5,
}

beforeEach(() => {
  findSuppliersByOwner.mockReset().mockResolvedValue(SUPPLIERS)
  assignSuppliersToDelegate.mockClear()
  createImportRequest.mockClear()
  markRequestFailed.mockClear()
})

describe('import suppliers: address group check', () => {
  it('submit imports only the suppliers whose group is open to the owner', async () => {
    const response = await post(submitPOST, SUBMIT_BODY)
    expect(response.status).toBe(200)
    expect(assignSuppliersToDelegate).toHaveBeenCalledWith(OPEN_ADDRESSES, 'delegator-a', 5, 'pokt1delegator')
  })

  it('submit refuses when every supplier is in a closed group', async () => {
    findSuppliersByOwner.mockResolvedValue(SUPPLIERS.slice(3))
    const response = await post(submitPOST, SUBMIT_BODY)
    expect(response.status).toBe(404)
    expect(assignSuppliersToDelegate).not.toHaveBeenCalled()
  })

  it('request offers the same suppliers submit would import', async () => {
    const response = await post(requestPOST, { ownerAddress: OWNER })
    expect(response.status).toBe(200)
    expect((await response.json()).data.matchingSuppliers).toBe(OPEN_ADDRESSES.length)
    expect(createImportRequest).toHaveBeenCalledWith(OWNER, 'delegator-a', OPEN_ADDRESSES)
  })
})
