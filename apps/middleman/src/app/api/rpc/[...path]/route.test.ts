jest.mock('server-only', () => ({}))

jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: async () => ({ pocketApiUrl: 'https://lcd.example/' }),
}))

import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const fetchMock = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock.mockResolvedValue({ status: 200, text: async () => '{}' })
  global.fetch = fetchMock as unknown as typeof fetch
})

function call(method: 'GET' | 'POST', segments: string[], query = '') {
  const request = new NextRequest(`http://middleman.test/api/rpc/${segments.join('/')}${query}`, {
    method,
    ...(method === 'POST' && { body: '{}' }),
  })
  const handler = method === 'GET' ? GET : POST
  return handler(request, { params: Promise.resolve({ path: segments }) })
}

describe('/api/rpc proxy', () => {
  it.each([
    ['GET', ['cosmos', 'base', 'tendermint', 'v1beta1', 'blocks', 'latest'], ''],
    ['GET', ['cosmos', 'auth', 'v1beta1', 'accounts', 'pokt1abc'], ''],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances', 'pokt1abc', 'by_denom'], '?denom=upokt'],
    ['POST', ['cosmos', 'tx', 'v1beta1', 'simulate'], ''],
  ] as const)('forwards the wallet call %s %j', async (method, segments, query) => {
    const response = await call(method, [...segments], query)
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(`https://lcd.example/${segments.join('/')}${query}`, expect.anything())
  })

  it.each([
    ['GET', ['cosmos', 'auth', 'v1beta1', 'accounts']],
    ['GET', ['cosmos', 'bank', 'v1beta1', 'balances']],
    ['GET', ['cosmos', 'staking', 'v1beta1', 'validators']],
    ['POST', ['cosmos', 'tx', 'v1beta1', 'txs']],
    ['GET', ['cosmos', 'tx', 'v1beta1', 'simulate']],
    ['GET', ['cosmos', 'auth', 'v1beta1', 'accounts', '..', '..', 'admin']],
    ['GET', ['cosmos', 'auth', 'v1beta1', 'accounts', '%2e%2e']],
    ['GET', ['cosmos', 'auth', 'v1beta1', 'accounts', 'a/../../b']],
    ['GET', []],
  ] as const)('refuses %s %j without reaching the node', async (method, segments) => {
    const response = await call(method, [...segments])
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
