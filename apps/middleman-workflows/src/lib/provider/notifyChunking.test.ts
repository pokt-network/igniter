import type { Provider } from '@igniter/db/middleman/schema'
import type { Logger } from '@igniter/logger'
import type ApplicationSettings from '@/lib/dal/applicationSettings'
import { MAX_ADDRESSES_PER_NOTIFY, ProviderService } from '@/lib/provider'
import { REQUEST_SIGNATURE_HEADER } from '@/lib/constants'

// The provider rejects a stake/unstaking notify with more than 1000 addresses
// (MAX_SUPPLIERS_PER_REQUEST in apps/provider). Middleman must split, and sign each chunk's body.
const GOVERNANCE_URL = 'https://provider.example'
const listed = { id: 1, name: 'P', identity: 'pokt1listed', url: 'http://internal/' } as Provider
const unlisted = { id: 2, name: 'Q', identity: 'pokt1unlisted', url: 'http://internal/' } as Provider

const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as Logger
const resolve = jest.fn(async (identity: string) =>
  identity === 'pokt1listed' ? { identity, url: GOVERNANCE_URL } : null)

const realFetch = global.fetch
let fetchMock: jest.Mock
let signMock: jest.SpyInstance
let service: ProviderService

const addressList = (n: number) => Array.from({ length: n }, (_, i) => `pokt1addr${i}`)

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
  global.fetch = fetchMock as unknown as typeof fetch
  service = new ProviderService({} as ApplicationSettings, logger, { resolve })
  // The signature depends on the exact payload, so a header can be matched back to its body.
  signMock = jest.spyOn(service, 'signPayload').mockImplementation(async (payload: string) => ({
    identity: 'mw-id',
    signature: `sig:${payload}`,
  }))
})

afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).addresses as string[])

describe.each([
  ['markOwnerStaked', (a: string[], p: Provider) => service.markOwnerStaked(a, p), '/api/suppliers/stake'],
  ['markOwnerUnstaking', (a: string[], p: Provider) => service.markOwnerUnstaking(a, p), '/api/suppliers/unstaking'],
] as const)('ProviderService.%s chunking', (_name, call, path) => {
  it.each([
    [1, [1]],
    [1000, [1000]],
    [1001, [1000, 1]],
    [2500, [1000, 1000, 500]],
  ])('sends %i addresses as requests of %j', async (n, sizes) => {
    const addresses = addressList(n)
    await call(addresses, listed)

    expect(fetchMock).toHaveBeenCalledTimes(sizes.length)
    expect(sentBodies().map((b) => b.length)).toEqual(sizes)
    expect(sentBodies().flat()).toEqual(addresses) // every address once, in order
    for (const [url] of fetchMock.mock.calls) expect(url).toBe(`${GOVERNANCE_URL}${path}`)
  })

  it('signs each chunk separately, over the exact body it sends', async () => {
    await call(addressList(2500), listed)

    expect(signMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers[REQUEST_SIGNATURE_HEADER]).toBe(`sig:${init.body}`)
      expect(JSON.parse(init.body).addresses.length).toBeLessThanOrEqual(MAX_ADDRESSES_PER_NOTIFY)
      expect(init.redirect).toBe('manual')
    }
  })

  it('sends every chunk even when one fails, then throws the first error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request' })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
    await expect(call(addressList(2500), listed)).rejects.toThrow('Bad Request')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('still sends one request for an empty list, as before chunking', async () => {
    await call([], listed)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentBodies()).toEqual([[]])
  })

  it('keeps the governance gate: no request for an unlisted provider', async () => {
    await expect(call(addressList(2500), unlisted)).rejects.toThrow('not in the governance source')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
