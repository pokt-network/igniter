import { lookup } from 'node:dns/promises'
import { maxChangesPerRun, planChanges, sanitizeProviders, type CurrentProvider } from '@/lib/governance/providersSync'

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
const mockLookup = lookup as jest.MockedFunction<typeof lookup>

// Read lazily by the egress guard on first use; mirrors the localnet dev overlay.
process.env.NOTIFICATION_EGRESS_ALLOWLIST = '10.0.0.0/8'

const PUBLIC = '93.184.216.34'
beforeEach(() => {
  mockLookup.mockReset()
  mockLookup.mockImplementation((async (host: string) => {
    if (host.endsWith('.svc.cluster.local')) return [{ address: '10.1.2.3', family: 4 }]
    if (host === 'internal.example') return [{ address: '169.254.169.254', family: 4 }]
    return [{ address: PUBLIC, family: 4 }]
  }) as never)
})

const row = (identity: string, url = `https://${identity}.example`, extra: Record<string, unknown> = {}) =>
  ({ name: `P-${identity}`, identity, identityHistory: [], url, ...extra })
const cur = (identity: string, url = `https://${identity}.example`): CurrentProvider =>
  ({ identity, name: `P-${identity}`, url, enabled: true, visible: true })

describe('sanitizeProviders', () => {
  it('accepts well-formed https rows to public hosts', async () => {
    const { providers, rejected } = await sanitizeProviders([row('a'), row('b')], [])
    expect(providers.map((p) => p.identity)).toEqual(['a', 'b'])
    expect(rejected).toEqual([])
  })

  it('rejects a non-array payload and an oversized one', async () => {
    await expect(sanitizeProviders({ a: 1 }, [])).rejects.toThrow('not an array')
    await expect(sanitizeProviders(Array(1001).fill(row('a')), [])).rejects.toThrow('max 1000')
  })

  it.each([
    ['http to a public host', row('a', 'http://a.example')],
    ['an internal host', row('a', 'https://internal.example')],
    ['a non-http scheme', row('a', 'file:///etc/passwd')],
    ['credentials in the url', row('a', 'https://u:p@a.example')],
    ['a bad identity', row('a b')],
    ['a non-string name', { ...row('a'), name: 5 }],
    ['a bad identityHistory', row('a', undefined, { identityHistory: [1] })],
  ])('rejects %s', async (_label, bad) => {
    const { providers, rejected } = await sanitizeProviders([bad], [])
    expect(providers).toEqual([])
    expect(rejected).toHaveLength(1)
  })

  it('accepts http only for an operator-allowlisted (in-cluster) host', async () => {
    const { providers } = await sanitizeProviders([row('a', 'http://provider.default.svc.cluster.local:3001')], [])
    expect(providers).toHaveLength(1)
  })

  it('keeps a known provider unchanged when its row is rejected (no rewrite, no disable)', async () => {
    const current = [cur('a')]
    const { providers, rejected } = await sanitizeProviders([row('a', 'https://internal.example')], current)
    expect(rejected).toHaveLength(1)
    expect(providers).toEqual([{ name: 'P-a', identity: 'a', identityHistory: [], url: 'https://a.example' }])
    expect(planChanges(providers, current)).toEqual([])
  })

  it('drops a duplicate identity', async () => {
    const { providers, rejected } = await sanitizeProviders([row('a'), row('a', 'https://other.example')], [])
    expect(providers).toHaveLength(1)
    expect(rejected[0]!.reason).toBe('duplicate identity')
  })
})

describe('planChanges', () => {
  it('lists adds, renames/url changes and disables', () => {
    const changes = planChanges(
      [row('a'), { ...row('b2'), identityHistory: ['b'] }, row('n')],
      [cur('a'), cur('b'), cur('gone')],
    )
    expect(changes.map((c) => c.kind).sort()).toEqual(['add', 'disable', 'update'])
    expect(changes.find((c) => c.kind === 'update')).toMatchObject({ fromIdentity: 'b', identity: 'b2' })
  })
})

describe('maxChangesPerRun', () => {
  it('defaults to 20 and accepts a positive integer override', () => {
    expect(maxChangesPerRun(undefined)).toBe(20)
    expect(maxChangesPerRun('abc')).toBe(20)
    expect(maxChangesPerRun('5')).toBe(5)
  })
})
