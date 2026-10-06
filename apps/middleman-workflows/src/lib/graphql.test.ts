import { postGraphql } from './graphql'

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('postGraphql', () => {
  it('throws with the status and messages on a 400 {errors} response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      errors: [{ message: 'Unknown argument "domains" on field "Query.getSupplierStatsByDomains". Did you mean "pDomains"?' }],
    }))

    await expect(postGraphql('https://indexer.test', 'query { x }')).rejects.toThrow(
      'Indexer GraphQL request failed with HTTP 400: Unknown argument "domains" on field "Query.getSupplierStatsByDomains". Did you mean "pDomains"?',
    )
  })

  it('throws on a 200 response that carries errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: null, errors: [{ message: 'boom' }] }))

    await expect(postGraphql('https://indexer.test', 'query { x }')).rejects.toThrow('HTTP 200: boom')
  })

  it('throws on a non-JSON error response', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }))

    await expect(postGraphql('https://indexer.test', 'query { x }')).rejects.toThrow('HTTP 502')
  })

  it('returns data and sends the query and variables', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { param: { value: '1' } } }))

    await expect(postGraphql('https://indexer.test', 'query q($a: Int) { x }', { a: 1 })).resolves.toEqual({ param: { value: '1' } })
    expect(fetchMock).toHaveBeenCalledWith('https://indexer.test', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ query: 'query q($a: Int) { x }', variables: { a: 1 } }),
    }))
  })
})
