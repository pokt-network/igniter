import { NextRequest } from 'next/server'

jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: async () => ({ pocketApiUrl: 'http://internal-api:1317/' }),
}))

import { GET, POST } from './route'

const originalFetch = globalThis.fetch
let mockFetch: jest.Mock

beforeEach(() => {
  mockFetch = jest.fn().mockResolvedValue({ status: 200, text: async () => '{}' })
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

function call(method: 'GET' | 'POST', segments: string[], query = '') {
  const request = new NextRequest(`http://localhost/api/rpc/${segments.join('/')}${query}`, {
    method,
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
  const handler = method === 'GET' ? GET : POST
  return handler(request, { params: Promise.resolve({ path: segments }) })
}

describe('/api/rpc proxy allowlist', () => {
  it.each([
    ['GET', 'cosmos/bank/v1beta1/balances/pokt1abc/by_denom', '?denom=upokt'],
    ['GET', 'cosmos/auth/v1beta1/accounts/pokt1abc', ''],
    ['GET', 'cosmos/base/tendermint/v1beta1/blocks/latest', ''],
    ['GET', 'pokt-network/poktroll/service/service', '?pagination.limit=500'],
    ['POST', 'cosmos/tx/v1beta1/simulate', ''],
  ] as const)('forwards %s %s', async (method, path, query) => {
    const response = await call(method, path.split('/'), query)
    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(`http://internal-api:1317/${path}${query}`, expect.objectContaining({ method }))
  })

  it.each([
    ['GET', ['cosmos', 'staking', 'v1beta1', 'validators']],
    ['GET', ['cosmos', 'tx', 'v1beta1', 'simulate']],
    ['POST', ['cosmos', 'tx', 'v1beta1', 'txs']],
    ['POST', ['cosmos', 'bank', 'v1beta1', 'balances', 'pokt1abc']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balancesX']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances']],
    ['GET', ['cosmos', 'auth', 'v1beta1', 'accounts']],
    ['GET', ['cosmos', 'base', 'tendermint', 'v1beta1', 'blocks', 'latest', 'x']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', '..', '..', '..', 'staking']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', '%2e%2e', 'x']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', '%252e%252e', 'x']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', '../../admin']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', '.']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', '..\\admin']],
    ['GET', []],
  ] as const)('refuses %s %j without contacting the node', async (method, segments) => {
    const response = await call(method, [...segments])
    expect(response.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
