import { postIndexerGraphql } from '@/lib/indexer'

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = realFetch
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('postIndexerGraphql', () => {
  it('returns data and sends an abort signal', async () => {
    fetchMock.mockResolvedValue(json({ data: { ok: 1 } }))
    await expect(postIndexerGraphql('https://indexer.test', 'query { ok }')).resolves.toEqual({ ok: 1 })
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts a request that exceeds the timeout', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
      }),
    )
    await expect(postIndexerGraphql('https://indexer.test', 'q', undefined, { timeoutMs: 20 })).rejects.toThrow()
  })

  it('redacts errors[].message from the thrown error', async () => {
    fetchMock.mockResolvedValue(json({ errors: [{ message: 'SECRET internal detail' }, { message: 'other' }] }, 400))
    const err = await postIndexerGraphql('https://indexer.test', 'q').catch((e: Error) => e)
    expect((err as Error).message).toBe('Indexer GraphQL request failed with HTTP 400 (2 errors, messages redacted)')
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('rejects a body larger than the cap (streamed)', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(5000), { status: 200 }))
    await expect(postIndexerGraphql('https://indexer.test', 'q', undefined, { maxBodyBytes: 1000 }))
      .rejects.toThrow('Indexer GraphQL response too large (HTTP 200)')
  })

  it('rejects a declared content-length above the cap without reading it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '999999' } }))
    await expect(postIndexerGraphql('https://indexer.test', 'q', undefined, { maxBodyBytes: 1000 }))
      .rejects.toThrow('too large')
  })

  it('throws on non-JSON or missing data', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }))
    await expect(postIndexerGraphql('https://indexer.test', 'q')).rejects.toThrow('Indexer GraphQL request failed with HTTP 502')
    fetchMock.mockResolvedValue(json({ data: null }))
    await expect(postIndexerGraphql('https://indexer.test', 'q')).rejects.toThrow('HTTP 200')
  })
})
