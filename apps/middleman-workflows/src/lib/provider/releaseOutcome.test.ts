import type { Provider } from '@igniter/db/middleman/schema'
import type { Logger } from '@igniter/logger'
import type ApplicationSettings from '@/lib/dal/applicationSettings'
import { ProviderService, RELEASE_TIMEOUT_MS } from '@/lib/provider'
import {
  classifyReleaseError,
  classifyReleaseResponse,
  RELEASE_LOCAL_PRE_SEND,
  RELEASE_NOT_SENT_CODES,
} from '@/lib/provider/releaseOutcome'
import {
  REQUEST_IDENTITY_HEADER,
  REQUEST_SIGNATURE_HEADER,
} from '@/lib/constants'

/** What undici's fetch rejects with: a TypeError whose `cause` carries the system error. */
function fetchFailed(code: string, extra: Record<string, unknown> = {}) {
  const cause = Object.assign(new Error(`connect ${code}`), { code, ...extra })
  return new TypeError('fetch failed', { cause })
}

describe('classifyReleaseError', () => {
  const NOT_SENT = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ]

  it('allow-list is exactly the design list', () => {
    expect([...RELEASE_NOT_SENT_CODES].sort()).toEqual([...NOT_SENT].sort())
  })

  it.each(NOT_SENT)('%s in undici cause → not-sent', (code) => {
    expect(classifyReleaseError(fetchFailed(code))).toEqual({ kind: 'not-sent', code })
  })

  it('reads a code nested two causes deep', () => {
    const inner = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    const middle = new Error('wrapped', { cause: inner })
    const err = new TypeError('fetch failed', { cause: middle })
    expect(classifyReleaseError(err)).toEqual({ kind: 'not-sent', code: 'ECONNREFUSED' })
  })

  it('reads a code set on the top-level error', () => {
    const err = Object.assign(new Error('refused'), { code: 'ENOTFOUND' })
    expect(classifyReleaseError(err)).toEqual({ kind: 'not-sent', code: 'ENOTFOUND' })
  })

  it.each([
    ['EPROTO', 'EPROTO'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_WRONG_VERSION_NUMBER'],
    ['UND_ERR_SOCKET', 'UND_ERR_SOCKET'],
    ['ECONNRESET', 'ECONNRESET'],
    ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'],
    ['prefix of an allowed code', 'ECONNREFUSED_EXTRA'],
    ['allowed code as a prefix', 'ECONN'],
    ['lower-case allowed code', 'econnrefused'],
  ])('%s → ambiguous with its code', (_label, code) => {
    expect(classifyReleaseError(fetchFailed(code))).toEqual({
      kind: 'ambiguous',
      code,
      message: 'TypeError: fetch failed',
    })
  })

  it('AbortSignal.timeout TimeoutError (no string code) → ambiguous without code', () => {
    const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(classifyReleaseError(err)).toEqual({
      kind: 'ambiguous',
      message: 'TimeoutError: The operation was aborted due to timeout',
    })
  })

  it('AbortError without code → ambiguous', () => {
    const err = new DOMException('This operation was aborted', 'AbortError')
    expect(classifyReleaseError(err)).toEqual({
      kind: 'ambiguous',
      message: 'AbortError: This operation was aborted',
    })
  })

  it('TimeoutError wrapped as the cause of fetch failed → ambiguous', () => {
    const cause = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const err = new TypeError('fetch failed', { cause })
    expect(classifyReleaseError(err)).toEqual({ kind: 'ambiguous', message: 'TypeError: fetch failed' })
  })

  it.each([
    ['plain Error', new Error('boom'), 'Error: boom'],
    ['string', 'boom', 'boom'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['object without code', { foo: 1 }, '[object Object]'],
  ])('unknown error (%s) → ambiguous', (_label, err, message) => {
    expect(classifyReleaseError(err)).toEqual({ kind: 'ambiguous', message })
  })

  it('a self-referencing cause does not loop', () => {
    const err = new Error('loop') as Error & { cause?: unknown }
    err.cause = err
    expect(classifyReleaseError(err)).toEqual({ kind: 'ambiguous', message: 'Error: loop' })
  })
})

describe('classifyReleaseResponse', () => {
  it.each([200, 204])('%i → ok', (status) => {
    expect(classifyReleaseResponse(status, 'OK')).toEqual({ kind: 'ok' })
  })

  it.each([
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [500, 'Internal Server Error'],
    [502, 'Bad Gateway'],
    [504, 'Gateway Timeout'],
    [302, 'Found'],
  ])('%i → ambiguous with status', (status, statusText) => {
    expect(classifyReleaseResponse(status, statusText)).toEqual({
      kind: 'ambiguous',
      status,
      message: `HTTP ${status} ${statusText}`,
    })
  })
})

describe('ProviderService.releaseSuppliersOutcome', () => {
  const provider = { id: 7, name: 'P', url: 'http://provider.test' } as Provider
  const addresses = ['pokt1x', 'pokt1y']
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as Logger
  const realFetch = global.fetch
  let fetchMock: jest.Mock
  let service: ProviderService

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    service = new ProviderService({} as ApplicationSettings, logger)
    jest.spyOn(service, 'signPayload').mockResolvedValue({ identity: 'mw-id', signature: 'sig' })
  })

  afterEach(() => {
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  it('POSTs like releaseSuppliers, with a timeout signal, and returns ok on 200', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({ kind: 'ok' })

    expect(service.signPayload).toHaveBeenCalledWith(JSON.stringify({ addresses }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://provider.test/api/suppliers/release')
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ addresses }),
      headers: {
        'Content-Type': 'application/json',
        [REQUEST_IDENTITY_HEADER]: 'mw-id',
        [REQUEST_SIGNATURE_HEADER]: 'sig',
      },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(RELEASE_TIMEOUT_MS).toBe(20_000)
  })

  it.each([200, 500])('cancels the response body (%i): the connection is freed, the outcome is the status', async (status) => {
    const response = new Response('body the middleman never reads', { status })
    const cancel = jest.spyOn(response.body!, 'cancel')
    fetchMock.mockResolvedValue(response)

    const outcome = await service.releaseSuppliersOutcome(addresses, provider)

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(outcome.kind).toBe(status === 200 ? 'ok' : 'ambiguous')
  })

  it('a body cancel that rejects does not change the outcome', async () => {
    const response = new Response('x', { status: 200 })
    jest.spyOn(response.body!, 'cancel').mockRejectedValue(new Error('already locked'))
    fetchMock.mockResolvedValue(response)

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({ kind: 'ok' })
  })

  it('500 → ambiguous with status', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500, statusText: 'Internal Server Error' }))

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({
      kind: 'ambiguous',
      status: 500,
      message: 'HTTP 500 Internal Server Error',
    })
  })

  it('thrown ECONNREFUSED cause → not-sent', async () => {
    fetchMock.mockRejectedValue(fetchFailed('ECONNREFUSED'))

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({
      kind: 'not-sent',
      code: 'ECONNREFUSED',
    })
  })

  it('abort by the timeout signal → ambiguous', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({
      kind: 'ambiguous',
      message: 'TimeoutError: The operation was aborted due to timeout',
    })
  })

  it('signing failure → not-sent LOCAL_PRE_SEND, no POST, no throw', async () => {
    jest.spyOn(service, 'signPayload').mockRejectedValue(new Error('Unable to sign the payload.'))

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({
      kind: 'not-sent',
      code: RELEASE_LOCAL_PRE_SEND,
    })
    expect(RELEASE_LOCAL_PRE_SEND).toBe('LOCAL_PRE_SEND')
    expect(RELEASE_NOT_SENT_CODES.has(RELEASE_LOCAL_PRE_SEND)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('settings read failure (real signPayload) → not-sent LOCAL_PRE_SEND, no POST', async () => {
    jest.restoreAllMocks()
    const settingsDal = { getFirst: jest.fn().mockRejectedValue(new Error('db down')) }
    service = new ProviderService(settingsDal as unknown as ApplicationSettings, logger)

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({
      kind: 'not-sent',
      code: RELEASE_LOCAL_PRE_SEND,
    })
    expect(settingsDal.getFirst).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an error once fetch was invoked is still classified, never LOCAL_PRE_SEND', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))

    await expect(service.releaseSuppliersOutcome(addresses, provider)).resolves.toEqual({
      kind: 'ambiguous',
      message: 'Error: socket hang up',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
