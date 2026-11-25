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

// Keys delivered to delegator-a; pokt1foreign belongs to another delegator.
const DELIVERED: Record<string, string> = { pokt1mine1: 'delegator-a', pokt1mine2: 'delegator-a', pokt1foreign: 'delegator-b' }
const listAddressesDeliveredTo = jest.fn(async (addresses: string[], identity: string) =>
  addresses.filter((a) => DELIVERED[a] === identity))
jest.mock('@/lib/dal/keys', () => ({
  listAddressesDeliveredTo: (addresses: string[], identity: string) => listAddressesDeliveredTo(addresses, identity),
}))

const workflowStart = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/temporal', () => ({
  getTemporalClient: () => ({ workflow: { start: workflowStart } }),
  getTemporalConfig: () => ({ taskQueue: 'provider' }),
}))

import { POST as stakePOST } from './route'
import { POST as unstakingPOST } from '../unstaking/route'

function post(handler: typeof stakePOST, addresses: unknown) {
  return handler(new Request('http://localhost/api/suppliers/x', {
    method: 'POST',
    headers: { [REQUEST_IDENTITY_HEADER]: 'delegator-a' },
    body: JSON.stringify({ addresses }),
  }))
}

beforeEach(() => {
  listAddressesDeliveredTo.mockClear()
  workflowStart.mockClear()
})

describe.each([
  ['stake', stakePOST],
  ['unstaking', unstakingPOST],
])('POST /api/suppliers/%s', (_label, handler) => {
  it("only acts on the caller's own suppliers", async () => {
    const response = await post(handler, ['pokt1mine1', 'pokt1foreign', 'pokt1mine2'])
    expect(response.status).toBe(200)
    expect(listAddressesDeliveredTo).toHaveBeenCalledWith(['pokt1mine1', 'pokt1foreign', 'pokt1mine2'], 'delegator-a')
    expect(workflowStart).toHaveBeenCalledWith('SupplierStatusForAddresses', expect.objectContaining({
      args: [{ addresses: ['pokt1mine1', 'pokt1mine2'] }],
    }))
  })

  it('refuses a list with none of its suppliers', async () => {
    const response = await post(handler, ['pokt1foreign'])
    expect(response.status).toBe(400)
    expect(workflowStart).not.toHaveBeenCalled()
  })

  it('accepts 1000 addresses and refuses 1001', async () => {
    const ok = await post(handler, Array.from({ length: 1000 }, () => 'pokt1mine1'))
    expect(ok.status).toBe(200)

    workflowStart.mockClear()
    listAddressesDeliveredTo.mockClear()
    const tooMany = await post(handler, Array.from({ length: 1001 }, () => 'pokt1mine1'))
    expect(tooMany.status).toBe(400)
    expect(listAddressesDeliveredTo).not.toHaveBeenCalled()
    expect(workflowStart).not.toHaveBeenCalled()
  })
})
