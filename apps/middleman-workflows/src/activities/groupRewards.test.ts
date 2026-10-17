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

function call() {
  return fetchAddressGroupRewards({
    indexerApiUrl: 'https://indexer.test',
    group: group([' eth ', 'eth', 'base']),
    domains: ['nodefleet.net'],
    startTs: new Date('2026-10-07T00:00:00Z'),
    endTs: new Date('2026-10-13T23:59:59.999Z'),
    supplierShare: 0.5,
  })
}

describe('fetchAddressGroupRewards', () => {
  it('returns the group rewards of its services at the supplier share', async () => {
    fetchMock.mockResolvedValue(json({ data: { data: { services: [row('eth', 100), row('sol', 50)] } } }))

    await expect(call()).resolves.toEqual({ id: 7, rewards: [{ ...row('eth', 100), amount: '50' }] })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).variables).toEqual({
      domains: ['nodefleet.net'], startTs: '2026-10-07T00:00:00.000Z', endTs: '2026-10-13T23:59:59.999Z',
    })
  })

  it('fails the group when the request fails', async () => {
    fetchMock.mockResolvedValue(json({ data: null, errors: [{ message: 'boom', path: ['data'] }] }))

    await expect(call()).rejects.toThrow('Indexer GraphQL request failed with HTTP 200: boom')
  })
})
