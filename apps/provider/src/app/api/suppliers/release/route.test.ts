jest.mock('server-only', () => ({}))

import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'

// The signature check is not under test here: the caller is delegator-a.
jest.mock('@/lib/utils/routes', () => ({
  truncateIdentity: (id: string) => id,
  ensureApplicationIsBootstrapped: async () => undefined,
  validateRequestSignature: async (request: Request) => ({
    delegator: { identity: 'delegator-a', name: 'A' },
    data: await request.json(),
  }),
}))

const releaseDeliveredSuppliers = jest.fn().mockResolvedValue([])
jest.mock('@/lib/services/suppliers', () => ({
  releaseDeliveredSuppliers: (...args: unknown[]) => releaseDeliveredSuppliers(...args),
}))

import { POST } from './route'

function post(body: unknown) {
  return POST(new Request('https://provider.test/api/suppliers/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [REQUEST_IDENTITY_HEADER]: 'delegator-a' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/suppliers/release', () => {
  it('releases only for the owner the keys were delivered to and the calling delegator', async () => {
    const response = await post({ addresses: ['pokt1a', 'pokt1b'], ownerAddress: 'pokt1owner' })
    expect(response.status).toBe(200)
    expect(releaseDeliveredSuppliers).toHaveBeenCalledWith(['pokt1a', 'pokt1b'], 'delegator-a', 'pokt1owner')
  })

  it.each([
    ['missing', { addresses: ['pokt1a'] }],
    ['empty', { addresses: ['pokt1a'], ownerAddress: '' }],
    ['not a string', { addresses: ['pokt1a'], ownerAddress: ['pokt1owner'] }],
  ])('refuses a request whose ownerAddress is %s, releasing nothing', async (_name, body) => {
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(releaseDeliveredSuppliers).not.toHaveBeenCalled()
  })
})
