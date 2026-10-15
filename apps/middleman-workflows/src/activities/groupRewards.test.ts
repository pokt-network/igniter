import type { AddressGroupsJson } from '@igniter/db/middleman/schema'
import { fetchAddressGroupRewards } from './groupRewards'

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const row = (service_id: string, gross_rewards: number) => ({
  service_id, gross_rewards, relays: 1, computed_units: 1, estimated_relays: 1, estimated_computed_units: 1, staked_suppliers: 3,
})
const group = (serviceIds: Array<string>) =>
  ({ id: 7, addressGroupServices: serviceIds.map((serviceId) => ({ serviceId })) }) as unknown as AddressGroupsJson[number]
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

function call(input: { serviceIds?: Array<string>; domains?: Array<string> } = {}) {
  const onCountFailed = jest.fn()
  const promise = fetchAddressGroupRewards({
    indexerApiUrl: 'https://indexer.test',
    group: group(input.serviceIds ?? [' eth ', 'eth', 'base']),
    domains: input.domains ?? ['nodefleet.net'],
    startTs: new Date('2026-10-07T00:00:00Z'),
    endTs: new Date('2026-10-13T23:59:59.999Z'),
    supplierShare: 0.5,
    onCountFailed,
  })
  const variables = () => JSON.parse(fetchMock.mock.calls[0]![1].body).variables
  return { promise, onCountFailed, variables }
}

describe('fetchAddressGroupRewards', () => {
  it('returns the group rewards of its services at the supplier share, and its own count', async () => {
    fetchMock.mockResolvedValue(json({ data: { data: { services: [row('eth', 100), row('sol', 50)] }, count: [{ supplierCount: '12' }] } }))
    const { promise, onCountFailed, variables } = call()

    await expect(promise).resolves.toEqual({ id: 7, rewards: [{ ...row('eth', 100), amount: '50' }], suppliersCount: 12 })
    expect(variables()).toMatchObject({ domains: ['nodefleet.net'], services: ['eth', 'base'], withCount: true })
    expect(onCountFailed).not.toHaveBeenCalled()
  })

  it('keeps the rewards with count 0 when the count alias fails, and reports it', async () => {
    fetchMock.mockResolvedValue(json({
      data: { data: { services: [row('eth', 100)] }, count: null },
      errors: [{ message: 'canceling statement due to statement timeout', path: ['count'] }],
    }))
    const { promise, onCountFailed } = call()

    await expect(promise).resolves.toEqual({ id: 7, rewards: [{ ...row('eth', 100), amount: '50' }], suppliersCount: 0 })
    expect(onCountFailed).toHaveBeenCalledWith('canceling statement due to statement timeout')
  })

  it('fails the group when the rewards alias fails', async () => {
    fetchMock.mockResolvedValue(json({
      data: { data: null, count: [{ supplierCount: '12' }] },
      errors: [{ message: 'boom', path: ['data'] }],
    }))

    await expect(call().promise).rejects.toThrow('Indexer rewards failed: boom')
  })

  it('does not ask for the count over 200 domains: count 0, rewards kept, nothing reported', async () => {
    fetchMock.mockResolvedValue(json({ data: { data: { services: [row('eth', 100)] } } }))
    const { promise, onCountFailed, variables } = call({ domains: ids(201, 'd') })

    await expect(promise).resolves.toMatchObject({ suppliersCount: 0, rewards: [{ service_id: 'eth' }] })
    expect(variables().withCount).toBe(false)
    expect(onCountFailed).not.toHaveBeenCalled()
  })

  it('does not ask for the count over 200 services: count 0', async () => {
    fetchMock.mockResolvedValue(json({ data: { data: { services: [] } } }))
    const { promise, variables } = call({ serviceIds: ids(201, 's') })

    await expect(promise).resolves.toMatchObject({ suppliersCount: 0 })
    expect(variables().withCount).toBe(false)
  })
})
