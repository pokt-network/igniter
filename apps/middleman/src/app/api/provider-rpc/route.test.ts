jest.mock('server-only', () => ({}))
// url-join ships ESM only, which ts-jest does not transform; a minimal stand-in is enough here.
jest.mock('url-join', () => ({
  __esModule: true,
  default: (...parts: string[]) =>
    parts.map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+/, ''))).join('/'),
}))

const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

jest.mock('@/lib/logging/withLogging', () => ({
  withLogging: (handler: unknown) => handler,
}))

const getByIdentity = jest.fn()
jest.mock('@/lib/dal/providers', () => ({ getByIdentity: (identity: string) => getByIdentity(identity) }))
jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: async () => ({ appIdentity: 'app-identity', delegatorRewardsAddress: 'pokt1server', fee: 7 }),
}))
const signPayload = jest.fn(async (_payload: string) => Buffer.from('sig'))
jest.mock('@igniter/commons/crypto', () => ({ signPayload: (payload: string) => signPayload(payload) }))

// The governance source lists the provider at its real url; the row carries an internal one.
const resolveGovernance = jest.fn()
jest.mock('@/lib/governance', () => ({ governance: { resolve: (identity: string) => resolveGovernance(identity) } }))

import { POST } from './route'
import { UserRole } from '@igniter/db/middleman/enums'
import { GovernanceUnavailableError } from '@igniter/commons/governance'

const fetchMock = jest.fn()

// The user's own deliveries: what a browser release may cover.
const claimRelease = jest.fn()
const recordDelivery = jest.fn()
const markDeliveriesReleased = jest.fn()
jest.mock('@/lib/dal/supplierDeliveries', () => ({
  claimRelease: (...args: unknown[]) => claimRelease(...args),
  recordDelivery: (...args: unknown[]) => recordDelivery(...args),
  markDeliveriesReleased: (...args: unknown[]) => markDeliveriesReleased(...args),
}))

const jsonReply = (body: unknown, status = 200, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } })
const handler = POST as unknown as (request: Request) => Promise<Response>

const enabledProvider = { identity: 'pokt1provider', url: 'http://internal.example:3100/x#', enabled: true, visible: true }

function post(body: unknown) {
  return handler(new Request('http://middleman.test/api/provider-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ user: { identity: 'pokt1user', role: UserRole.User } })
  getByIdentity.mockResolvedValue(enabledProvider)
  resolveGovernance.mockImplementation(async (identity: string) => ({ identity, url: 'https://provider.example' }))
  fetchMock.mockImplementation(async () => jsonReply({ ok: true }))
  claimRelease.mockResolvedValue({ kind: 'ok', deliveryIds: [11], ownerAddress: 'pokt1owner', addresses: ['pokt1a'] })
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('POST /api/provider-rpc', () => {
  it('returns 401 without a session', async () => {
    auth.mockResolvedValue(null)
    const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: {} })
    expect(response.status).toBe(401)
    expect(getByIdentity).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [undefined],
    [{ enabled: false, visible: true }],
    [{ enabled: true, visible: false }],
  ])('returns 404 for a provider that is not enabled and visible (%p)', async (flags) => {
    getByIdentity.mockResolvedValue(flags ? { ...enabledProvider, ...flags } : undefined)
    const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: {} })
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    '/internal/api/v1/query',
    'http://169.254.169.254/latest/meta-data',
    '//other.example/api/suppliers',
    '/api/suppliers/../../metrics',
    '/api/suppliers',
    '/api/suppliers?simulate=true&x=1',
    '/api/suppliers/release#x',
    'api/suppliers/release',
  ])('returns 400 for a path outside the allowlist: %s', async (path) => {
    const response = await post({ provider: 'pokt1provider', path, data: {} })
    expect(response.status).toBe(400)
    expect(getByIdentity).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    '/api/suppliers?simulate=true',
    '/api/suppliers?simulate=false',
    '/api/suppliers/release',
    '/api/import-suppliers/request',
    '/api/import-suppliers/submit',
    '/api/import-suppliers/status',
  ])('forwards an allowed path to the provider: %s', async (path) => {
    const response = await post({ provider: 'pokt1provider', path, data: { a: 1, addresses: ['pokt1a'] } })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(`https://provider.example${path}`, expect.objectContaining({ method: 'POST' }))
  })

  it('returns 404 for an enabled provider the governance source does not list', async () => {
    resolveGovernance.mockResolvedValue(null)
    const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: {} })
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 when the governance source is unavailable', async () => {
    resolveGovernance.mockRejectedValue(new GovernanceUnavailableError('down'))
    const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: {} })
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never calls the url stored in the row', async () => {
    await post({ provider: 'pokt1provider', path: '/api/import-suppliers/status', data: {} })
    expect(fetchMock.mock.calls[0][0]).toBe('https://provider.example/api/import-suppliers/status')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('internal.example')
  })

  it.each([
    '/api/suppliers?simulate=true',
    '/api/suppliers?simulate=false',
    '/api/import-suppliers/submit',
  ])('replaces the client delegator address and rev share with the server settings before signing: %s', async (path) => {
    const data = { ownerAddress: 'pokt1owner', delegatorAddress: 'pokt1other', revSharePercentage: 0 }
    const response = await post({ provider: 'pokt1provider', path, data })
    expect(response.status).toBe(200)

    const expected = { ownerAddress: 'pokt1owner', delegatorAddress: 'pokt1server', revSharePercentage: 7 }
    expect(JSON.parse(signPayload.mock.calls[0]![0])).toEqual(expected)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expected)
  })

  it('leaves the body of other paths as sent', async () => {
    const data = { addresses: ['pokt1a'], delegatorAddress: 'pokt1client' }
    await post({ provider: 'pokt1provider', path: '/api/import-suppliers/status', data })
    expect(JSON.parse(signPayload.mock.calls[0]![0])).toEqual(data)
  })

  it('returns 401 for a session without a user identity', async () => {
    auth.mockResolvedValue({ expires: '2099-01-01T00:00:00.000Z' })
    const response = await post({ provider: 'pokt1provider', path: '/api/import-suppliers/status', data: {} })
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("passes the provider's status through, with its JSON body", async () => {
    fetchMock.mockImplementation(async () => jsonReply({ error: 'No addresses available' }, 400))
    const response = await post({ provider: 'pokt1provider', path: '/api/import-suppliers/status', data: {} })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'No addresses available' })
  })

  it.each([
    ['a redirect', () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })],
    ['a non-JSON body', () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['an oversize body', () => jsonReply({ blob: 'x'.repeat(2 * 1024 * 1024 + 10) })],
  ])('refuses %s from the provider with 502', async (_name, reply) => {
    fetchMock.mockImplementation(async () => reply())
    const response = await post({ provider: 'pokt1provider', path: '/api/import-suppliers/status', data: {} })
    expect(response.status).toBe(502)
  })

  it('never follows a provider redirect', async () => {
    await post({ provider: 'pokt1provider', path: '/api/import-suppliers/status', data: {} })
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'manual' }))
  })

  describe('deliveries and browser releases (e2e Bug 1)', () => {
    it("records the suppliers delivered to this user's real request", async () => {
      fetchMock.mockImplementation(async () => jsonReply({ data: [{ operatorAddress: 'pokt1a' }, { operatorAddress: 'pokt1b' }] }))
      await post({ provider: 'pokt1provider', path: '/api/suppliers?simulate=false', data: { ownerAddress: 'pokt1owner' } })
      expect(recordDelivery).toHaveBeenCalledWith({
        userIdentity: 'pokt1user', providerIdentity: 'pokt1provider', ownerAddress: 'pokt1owner', addresses: ['pokt1a', 'pokt1b'],
      })
    })

    it('does not record a simulation or a refused request', async () => {
      await post({ provider: 'pokt1provider', path: '/api/suppliers?simulate=true', data: { ownerAddress: 'pokt1owner' } })
      fetchMock.mockImplementation(async () => jsonReply({ error: 'no' }, 400))
      await post({ provider: 'pokt1provider', path: '/api/suppliers?simulate=false', data: { ownerAddress: 'pokt1owner' } })
      expect(recordDelivery).not.toHaveBeenCalled()
    })

    it("refuses user A releasing user B's delivery: nothing of A's covers it, so nothing is sent", async () => {
      claimRelease.mockResolvedValue({ kind: 'none' })
      const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: { addresses: ['pokt1b-delivered'], ownerAddress: 'pokt1otheruser' } })
      expect(response.status).toBe(403)
      expect(claimRelease).toHaveBeenCalledWith('pokt1user', 'pokt1provider', ['pokt1b-delivered'])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("releases only the user's own delivered addresses, with the owner from the record", async () => {
      claimRelease.mockResolvedValue({ kind: 'ok', deliveryIds: [11], ownerAddress: 'pokt1recordedowner', addresses: ['pokt1a'] })
      const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: { addresses: ['pokt1a', 'pokt1other'], ownerAddress: 'pokt1clientsays' } })
      expect(response.status).toBe(200)
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ addresses: ['pokt1a'], ownerAddress: 'pokt1recordedowner' })
      expect(markDeliveriesReleased).toHaveBeenCalledWith([11])
    })

    it('does not mark the delivery released when the provider refuses', async () => {
      fetchMock.mockImplementation(async () => jsonReply({ error: 'x' }, 500))
      await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: { addresses: ['pokt1a'] } })
      expect(markDeliveriesReleased).not.toHaveBeenCalled()
    })

    it('refuses a release with no address list', async () => {
      const response = await post({ provider: 'pokt1provider', path: '/api/suppliers/release', data: {} })
      expect(response.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
