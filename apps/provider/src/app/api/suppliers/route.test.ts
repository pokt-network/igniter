jest.mock('server-only', () => ({}))

import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'

// The signature check is not under test here: it hands back the parsed body as
// the caller's signed payload.
jest.mock('@/lib/utils/routes', () => ({
  truncateIdentity: (id: string) => id,
  ensureApplicationIsBootstrapped: async () => undefined,
  validateRequestSignature: async (request: Request) => ({
    delegator: { identity: 'delegator-a', name: 'A' },
    data: await request.json(),
  }),
}))

const findById = jest.fn()
jest.mock('@/lib/dal/addressGroups', () => ({ findById: (id: number) => findById(id) }))

const getSupplierStakeConfigurations = jest.fn()
jest.mock('@/lib/services/suppliers', () => ({
  getSupplierStakeConfigurations: (...args: unknown[]) => getSupplierStakeConfigurations(...args),
}))

import { POST } from './route'

const OWNER = 'pokt1owner0000000000000000000000000000000'

function body(overrides: Record<string, unknown> = {}) {
  return {
    addressGroupId: 7,
    ownerAddress: OWNER,
    revSharePercentage: 5,
    delegatorAddress: 'pokt1delegator',
    items: [{ amount: 60000000000, qty: 2 }],
    ...overrides,
  }
}

function post(payload: unknown, simulate = false) {
  return POST(new Request(`http://localhost/api/suppliers?simulate=${simulate}`, {
    method: 'POST',
    headers: { [REQUEST_IDENTITY_HEADER]: 'delegator-a' },
    body: JSON.stringify(payload),
  }))
}

beforeEach(() => {
  findById.mockReset().mockResolvedValue({ id: 7, private: false, linkedAddresses: [] })
  getSupplierStakeConfigurations.mockReset().mockResolvedValue([{ operatorAddress: 'pokt1op', stakeAmount: '1', services: [] }])
})

describe('POST /api/suppliers address group check', () => {
  it('serves an open group', async () => {
    const response = await post(body())
    expect(response.status).toBe(200)
    expect(getSupplierStakeConfigurations).toHaveBeenCalledTimes(1)
  })

  it('serves a group linked to the owner (case-insensitive)', async () => {
    findById.mockResolvedValue({ id: 7, private: false, linkedAddresses: [OWNER.toUpperCase()] })
    const response = await post(body())
    expect(response.status).toBe(200)
  })

  it.each([
    ['a private group', { id: 7, private: true, linkedAddresses: [] }],
    ['a private group even if linked to the owner', { id: 7, private: true, linkedAddresses: [OWNER] }],
    ['a group linked to other owners', { id: 7, private: false, linkedAddresses: ['pokt1other'] }],
    ['an unknown group', undefined],
  ])('refuses %s', async (_label, group) => {
    findById.mockResolvedValue(group)
    for (const simulate of [false, true]) {
      const response = await post(body(), simulate)
      expect(response.status).toBe(403)
    }
    expect(getSupplierStakeConfigurations).not.toHaveBeenCalled()
  })
})

describe('POST /api/suppliers size caps', () => {
  it('accepts exactly 1000 suppliers', async () => {
    const response = await post(body({ items: [{ amount: 1, qty: 600 }, { amount: 2, qty: 400 }] }))
    expect(response.status).toBe(200)
  })

  it.each([
    ['more than 1000 suppliers', [{ amount: 1, qty: 1001 }]],
    ['more than 1000 suppliers across items', [{ amount: 1, qty: 600 }, { amount: 2, qty: 401 }]],
    ['more than 10 items', Array.from({ length: 11 }, () => ({ amount: 1, qty: 1 }))],
    ['a zero qty', [{ amount: 1, qty: 0 }]],
    ['a negative qty', [{ amount: 1, qty: -1 }]],
    ['a fractional qty', [{ amount: 1, qty: 1.5 }]],
    ['a non-numeric qty', [{ amount: 1, qty: '5' }]],
    ['a non-positive amount', [{ amount: 0, qty: 1 }]],
  ])('refuses %s', async (_label, items) => {
    const response = await post(body({ items }))
    expect(response.status).toBe(400)
    expect(getSupplierStakeConfigurations).not.toHaveBeenCalled()
  })
})
