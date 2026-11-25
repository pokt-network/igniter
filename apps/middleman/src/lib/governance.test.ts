jest.mock('server-only', () => ({}))
jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: jest.fn(async () => ({ chainId: 'pocket' })),
}))

// Read once by the egress guard, on first use. A host literal only: no CIDR, so no case below
// needs DNS (an IP literal resolves locally).
process.env.NOTIFICATION_EGRESS_ALLOWLIST = 'localhost'
process.env.PROVIDERS_CDN_URL = 'https://cdn.example/{chainId}/providers.json'

import { providerUrlError } from './governance'

describe('providerUrlError', () => {
  it.each([
    ['http to an operator-allowlisted host', 'http://localhost:3001', null],
    ['https to an operator-allowlisted host', 'https://localhost:3001', null],
    ['http to a host the operator did not allowlist', 'http://10.1.2.3:3001', 'url must be https'],
    ['https to the metadata address', 'https://169.254.169.254/latest', 'Destination address is not allowed'],
    ['another protocol', 'ftp://localhost/x', 'url must be https'],
    ['credentials in the url', 'https://user:pass@localhost', 'url carries credentials'],
    ['not a url', 'not a url', 'invalid url'],
  ])('%s', async (_name, url, expected) => {
    await expect(providerUrlError(url)).resolves.toBe(expected)
  })
})

describe('governance registry', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('leaves out an entry whose url breaks the rule and keeps the others', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify([
      { name: 'Good', identity: 'pokt1good', identityHistory: [], url: 'http://localhost:3001' },
      { name: 'Bad', identity: 'pokt1bad', identityHistory: [], url: 'http://169.254.169.254/' },
    ]), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    // The registry binds fetch when it is created, so load a fresh copy after the mock is in place.
    let governance!: typeof import('./governance')['governance']
    await jest.isolateModulesAsync(async () => {
      ({ governance } = await import('./governance'))
    })

    await expect(governance.resolve('pokt1bad')).resolves.toBeNull()
    await expect(governance.resolve('pokt1good')).resolves.toEqual({ identity: 'pokt1good', url: 'http://localhost:3001' })
  })
})

describe('governance registry on a DNS failure', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.dontMock('node:dns/promises')
  })

  it('fails closed (cold cache) instead of leaving the provider out', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify([
      { name: 'Good', identity: 'pokt1good', identityHistory: [], url: 'https://provider.example' },
    ]), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    let governance!: typeof import('./governance')['governance']
    let GovernanceUnavailableError!: typeof import('@igniter/commons/governance')['GovernanceUnavailableError']
    await jest.isolateModulesAsync(async () => {
      jest.doMock('node:dns/promises', () => ({
        lookup: async () => { throw Object.assign(new Error('queryA EAI_AGAIN'), { code: 'EAI_AGAIN' }) },
      }))
      ;({ governance } = await import('./governance'))
      ;({ GovernanceUnavailableError } = await import('@igniter/commons/governance'))
    })

    await expect(governance.resolve('pokt1good')).rejects.toBeInstanceOf(GovernanceUnavailableError)
  })
})
