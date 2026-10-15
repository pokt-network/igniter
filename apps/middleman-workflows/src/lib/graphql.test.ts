import { postGraphql, postGraphqlPartial } from './graphql'

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
      errors: [{ message: 'Unknown argument "pDomains" on field "Query.getSupplierFleetList". Did you mean "domains"?' }],
    }))

    await expect(postGraphql('https://indexer.test', 'query { x }')).rejects.toThrow(
      'Indexer GraphQL request failed with HTTP 400: Unknown argument "pDomains" on field "Query.getSupplierFleetList". Did you mean "domains"?',
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

describe('postGraphqlPartial', () => {
  it('returns the data of the other aliases with an alias error keyed by its alias', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      data: { data: { services: [] }, count: null },
      errors: [{ message: 'domains must have between 1 and 200 elements (has 201)', path: ['count'] }],
    }))

    await expect(postGraphqlPartial('https://indexer.test', 'query { x }')).resolves.toEqual({
      data: { data: { services: [] }, count: null },
      errors: { count: 'domains must have between 1 and 200 elements (has 201)' },
    })
  })

  it('throws on an error with no alias (a document the schema rejects)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: [{ message: 'Unknown argument "x"' }] }))

    await expect(postGraphqlPartial('https://indexer.test', 'query { x }')).rejects.toThrow('HTTP 400: Unknown argument "x"')
  })

  it('throws when the answer has no data', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: null, errors: [{ message: 'boom', path: ['data'] }] }))

    await expect(postGraphqlPartial('https://indexer.test', 'query { x }')).rejects.toThrow('HTTP 200: boom')
  })
})
