import type { Provider } from '@igniter/db/middleman/schema'
import type { Logger } from '@igniter/logger'
import type ApplicationSettings from '@/lib/dal/applicationSettings'
import { GovernanceUnavailableError } from '@igniter/commons/governance'
import { ProviderService } from '@/lib/provider'
import { RELEASE_LOCAL_PRE_SEND, RELEASE_NOT_IN_GOVERNANCE } from '@/lib/provider/releaseOutcome'
import { MAX_PROVIDER_RESPONSE_BYTES } from '@igniter/commons/providerFetch'

// The row's url points at an internal host; the governance source
// lists the same identity at its real url. Every call must go to the governance url, or nowhere.
const INTERNAL_URL = 'http://internal.example:3100/x#'
const GOVERNANCE_URL = 'https://provider.example'

const listed = { id: 1, name: 'P', identity: 'pokt1listed', url: INTERNAL_URL } as Provider
const unlisted = { id: 2, name: 'Q', identity: 'pokt1unlisted', url: INTERNAL_URL } as Provider

const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as Logger
const resolve = jest.fn(async (identity: string) =>
  identity === 'pokt1listed' ? { identity, url: GOVERNANCE_URL } : null)

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  })
}

const realFetch = global.fetch
let fetchMock: jest.Mock
let service: ProviderService

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock = jest.fn(async () => jsonResponse({ data: { status: 'completed' } }))
  global.fetch = fetchMock as unknown as typeof fetch
  service = new ProviderService({} as ApplicationSettings, logger, { resolve })
  jest.spyOn(service, 'signPayload').mockResolvedValue({ identity: 'mw-id', signature: 'sig' })
})

afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const calls: Array<[string, (p: Provider) => Promise<unknown>, string]> = [
  ['status', (p) => service.status(p, 'sig', 'mw-id'), '/api/status'],
  ['markOwnerStaked', (p) => service.markOwnerStaked(['pokt1a'], p), '/api/suppliers/stake'],
  ['markOwnerUnstaking', (p) => service.markOwnerUnstaking(['pokt1a'], p), '/api/suppliers/unstaking'],
  ['releaseSuppliers', (p) => service.releaseSuppliers(['pokt1a'], p, 'pokt1owner'), '/api/suppliers/release'],
  ['releaseSuppliersOutcome', (p) => service.releaseSuppliersOutcome(['pokt1a'], p, 'pokt1owner'), '/api/suppliers/release'],
  ['checkImportStatus', (p) => service.checkImportStatus(p, { ownerAddress: 'pokt1o' }, 'sig', 'mw-id'), '/api/import-suppliers/status'],
]

describe.each(calls)('ProviderService.%s', (_name, call, path) => {
  it('calls the governance url, never the url stored in the row', async () => {
    await call(listed)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${GOVERNANCE_URL}${path}`)
  })

  it('makes no call for a provider the governance source does not list', async () => {
    await call(unlisted).catch(() => undefined)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { identity: 'pokt1unlisted' })
  })

  it('makes no call when the governance source is unavailable', async () => {
    resolve.mockRejectedValueOnce(new GovernanceUnavailableError('down'))
    await call(listed).catch(() => undefined)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never lets fetch follow a redirect', async () => {
    await call(listed).catch(() => undefined)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })
})

describe('a provider that answers a redirect', () => {
  // Models fetch: unless told `redirect: 'manual'`, it follows the 302 to the internal target and
  // returns whatever that answers, here a healthy, successful reply.
  beforeEach(() => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.redirect === 'manual'
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })
        : jsonResponse({ healthy: true, regions: ['followed'], data: { status: 'completed' } }))
  })

  it('status reports the provider unreachable', async () => {
    await expect(service.status(listed, 'sig', 'mw-id')).resolves.toEqual({ id: listed.id, status: 'unreachable' })
  })

  it('the notify and release calls fail', async () => {
    await expect(service.markOwnerStaked(['pokt1a'], listed)).rejects.toThrow('redirect')
    await expect(service.markOwnerUnstaking(['pokt1a'], listed)).rejects.toThrow('redirect')
    await expect(service.releaseSuppliers(['pokt1a'], listed, 'pokt1owner')).rejects.toThrow('redirect')
  })

  it('releaseSuppliersOutcome ends ambiguous with the 302, without throwing', async () => {
    await expect(service.releaseSuppliersOutcome(['pokt1a'], listed, 'pokt1owner')).resolves.toEqual({
      kind: 'ambiguous',
      status: 302,
      message: expect.stringContaining('HTTP 302'),
    })
  })

  it('checkImportStatus fails', async () => {
    await expect(service.checkImportStatus(listed, { ownerAddress: 'pokt1o' }, 'sig', 'mw-id')).rejects.toThrow('redirect')
  })
})

describe('a provider reply that is not a small JSON body', () => {
  const healthyBody = { healthy: true, data: { status: 'completed' } }
  const replies: Array<[string, () => Response]> = [
    ['a text/html body', () => new Response(JSON.stringify(healthyBody), { status: 200, headers: { 'content-type': 'text/html' } })],
    ['an oversize body', () => jsonResponse({ ...healthyBody, pad: 'x'.repeat(MAX_PROVIDER_RESPONSE_BYTES) })],
  ]

  describe.each(replies)('%s', (_name, reply) => {
    beforeEach(() => {
      fetchMock.mockImplementation(async () => reply())
    })

    it('is refused by status, which reports the provider unreachable', async () => {
      await expect(service.status(listed, 'sig', 'mw-id')).resolves.toEqual({ id: listed.id, status: 'unreachable' })
    })

    it('is refused by checkImportStatus', async () => {
      await expect(service.checkImportStatus(listed, { ownerAddress: 'pokt1o' }, 'sig', 'mw-id')).rejects.toThrow('provider reply')
    })
  })
})

describe('what an unlisted provider gets back', () => {
  it('status returns null, so nothing is written', async () => {
    await expect(service.status(unlisted, 'sig', 'mw-id')).resolves.toBeNull()
  })

  it('the throwing calls throw instead of reporting success', async () => {
    await expect(service.markOwnerStaked(['pokt1a'], unlisted)).rejects.toThrow('not in the governance source')
    await expect(service.markOwnerUnstaking(['pokt1a'], unlisted)).rejects.toThrow('not in the governance source')
    await expect(service.releaseSuppliers(['pokt1a'], unlisted, 'pokt1owner')).rejects.toThrow('not in the governance source')
    await expect(service.checkImportStatus(unlisted, { ownerAddress: 'pokt1o' }, 'sig', 'mw-id')).rejects.toThrow('not in the governance source')
  })

  it('releaseSuppliersOutcome reports not-sent with its own code', async () => {
    await expect(service.releaseSuppliersOutcome(['pokt1a'], unlisted, 'pokt1owner')).resolves.toEqual({ kind: 'not-sent', code: RELEASE_NOT_IN_GOVERNANCE })
  })

  it('releaseSuppliersOutcome reports a source outage as not-sent before the call', async () => {
    resolve.mockRejectedValueOnce(new GovernanceUnavailableError('down'))
    await expect(service.releaseSuppliersOutcome(['pokt1a'], listed, 'pokt1owner')).resolves.toEqual({ kind: 'not-sent', code: RELEASE_LOCAL_PRE_SEND })
  })
})

describe('status reply whitelist', () => {
  it('keeps only the fields the provider reports about itself', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
        healthy: true,
        regions: ['us'],
        allowedStakers: ['pokt1s'],
        minimumStake: 60000,
        allowPublicStaking: true,
        fee: 5,
        feeType: 'fixed',
        domains: ['p.example'],
        addressGroups: [],
        rewardAddresses: ['pokt1r'],
        returnSupplierFundsToOwner: true,
        // Fields outside the whitelist in the reply:
        url: 'http://169.254.169.254/',
        identity: 'pokt1other',
        enabled: true,
        visible: true,
        id: 999,
        name: 'Other',
        operationalFunds: 0,
    }))

    const result = await service.status(listed, 'sig', 'mw-id')

    expect(result).toEqual({
      id: listed.id,
      status: 'healthy',
      regions: ['us'],
      allowedStakers: ['pokt1s'],
      minimumStake: 60000,
      allowPublicStaking: true,
      fee: 5,
      feeType: 'fixed',
      domains: ['p.example'],
      addressGroups: [],
      rewardAddresses: ['pokt1r'],
      returnSupplierFundsToOwner: true,
    })
  })
})
