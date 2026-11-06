import funnelFixture from './__fixtures__/analytics-funnel-2026-10-20.json'
import sessionListFixture from './__fixtures__/analytics-session-list-2026-10-20.json'
import suppliersFixture from './__fixtures__/analytics-suppliers.json'
import selectionFixture from './__fixtures__/analytics-selection-counts-973641.json'
import {
  ANALYTICS_MAX_ALIASES,
  fetchSelectionCounts,
  fetchSupplierSessionFunnel,
  fetchSupplierSessionPage,
  ANALYTICS_SESSION_PAGE_SIZE,
  parseSupplierSessionFunnel,
  parseSupplierSessionList,
} from './analytics'

// Captured once from data.pocket.network on 2026-10-25: three nodefleet.net suppliers over the closed day
// 2026-10-20 (getSupplierFleetList first: 3, then one funnel call and one session-list page).
const suppliers = suppliersFixture.data.getSupplierFleetList.map((r) => r.supplierId)
const funnelScalar = funnelFixture.data.getSupplierSessionFunnelJson
const sessionScalar = sessionListFixture.data.getSupplierSessionListJson

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('parseSupplierSessionFunnel', () => {
  const answer = parseSupplierSessionFunnel(funnelScalar)

  it('reads the range envelope', () => {
    expect(answer.range).toEqual({
      coveredFrom: '2026-10-20T00:00:00+00:00',
      coveredTo: '2026-10-21T00:00:00+00:00',
      gaps: [],
    })
  })

  it('maps every snake_case column and keeps numbers as strings', () => {
    expect(answer.rows).toHaveLength(100)
    expect(answer.rows[0]).toEqual({
      bucketStart: '2026-10-20T00:00:00+00:00',
      serviceId: 'akash',
      supplierId: 'pokt105hddskh32r28umwkgpe5p30sn7fruj4rr7q2p',
      seats: '3',
      paid: '1',
      settledZero: '0',
      expired: '0',
      discarded: '0',
      slashed: '0',
      idleOthersWorked: '0',
      idleNoWork: '2',
      unresolved: '0',
      active: '0',
      paidUpokt: '10486',
      equalShareUpokt: '153122',
      relays: '17',
      computeUnits: '107474',
      sessionsWithSelected: '3',
      poolUpokt: '7656098',
      rosterSeats: '150',
      networkSessions: '142',
      firstHeight: '972493',
      lastHeight: '973653',
    })
  })

  it('throws on a row it does not expect', () => {
    const bad = { ...funnelScalar, data: [{ ...funnelScalar.data[0], seats: 'three' }] }
    expect(() => parseSupplierSessionFunnel(bad)).toThrow('seats is "three"')
    expect(() => parseSupplierSessionFunnel([])).toThrow('not an object')
  })
})

describe('parseSupplierSessionList', () => {
  const page = parseSupplierSessionList(sessionScalar)

  it('maps a session row', () => {
    expect(page.rows).toHaveLength(229)
    expect(page.rows[0]).toEqual({
      sessionId: 'ce95dc3486850e652580f79fccd62e27308e41ea51d3f02e029441f9c9d633ae',
      applicationId: 'pokt1640lmzpetrwmgfvnjklsl7pysw9uk2dcgdkhp4',
      serviceId: 'op',
      startHeight: '973641',
      endHeight: '973660',
      startTime: '2026-10-20T23:43:06.258+00:00',
      phase: 'settled',
      settlementHeight: '973693',
      settledHeight: '973693',
      moneyMissing: false,
      rosterSize: '50',
      candidates: '4499',
      claimed: '0',
      paidUpokt: null,
      settledUpokt: null,
      relays: null,
      computeUnits: null,
      selectedSupplierIds: ['pokt107nvujhefywzn75209wyjv5j3cuzsvnp7nlq49'],
      selectedStates: ['idle_no_work'],
      selectedPaidUpokt: [null],
      selectedEqualShareUpokt: ['0'],
    })
  })

  it('agrees with the funnel: seats = members, Y = what the members were paid', () => {
    const funnel = parseSupplierSessionFunnel(funnelScalar)
    const sum = (xs: Array<string | null>) => xs.reduce((a, x) => a + BigInt(x ?? 0), 0n)
    const members = page.rows.flatMap((r) => r.selectedSupplierIds)
    expect(BigInt(members.length)).toBe(sum(funnel.rows.map((r) => r.seats)))
    expect(sum(page.rows.flatMap((r) => r.selectedPaidUpokt))).toBe(sum(funnel.rows.map((r) => r.paidUpokt)))
  })

  it('throws when the selected_* arrays disagree', () => {
    const bad = { ...sessionScalar, data: [{ ...sessionScalar.data[0], selected_states: [] }] }
    expect(() => parseSupplierSessionList(bad)).toThrow('selected_* arrays differ in length')
  })
})

describe('fetchSupplierSessionFunnel / fetchSupplierSessionPage', () => {
  it('sends only the suppliers selector', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { funnel: funnelScalar } }))
    const answer = await fetchSupplierSessionFunnel('https://indexer.test', {
      suppliers,
      rangeStart: '2026-10-20T00:00:00Z',
      rangeEnd: '2026-10-21T02:00:00Z',
    })
    expect(answer.rows).toHaveLength(100)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables).toEqual({ suppliers, rangeStart: '2026-10-20T00:00:00Z', rangeEnd: '2026-10-21T02:00:00Z' })
    expect(body.query).toContain('getSupplierSessionFunnelJson')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(body.query).not.toMatch(/domains|owners|operators/)
  })

  it('passes the page cursor and the page size', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { sessions: sessionScalar } }))
    await fetchSupplierSessionPage('https://indexer.test', {
      suppliers,
      rangeStart: '2026-10-20T00:00:00Z',
      rangeEnd: '2026-10-21T00:00:00Z',
      before: { height: '973641', sessionId: 'abc' },
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables).toEqual({
      suppliers,
      rangeStart: '2026-10-20T00:00:00Z',
      rangeEnd: '2026-10-21T00:00:00Z',
      rowLimit: ANALYTICS_SESSION_PAGE_SIZE,
      beforeHeight: '973641',
      beforeSessionId: 'abc',
    })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(body.query).not.toMatch(/domains|owners|operators/)
  })

  it('never sends an empty or oversized supplier list', async () => {
    const range = { rangeStart: '2026-10-20T00:00:00Z', rangeEnd: '2026-10-21T00:00:00Z' }
    await expect(fetchSupplierSessionFunnel('https://indexer.test', { ...range, suppliers: [] })).rejects.toThrow('at least one')
    const tooMany = Array.from({ length: 201 }, (_, i) => `pokt1${i}`)
    await expect(fetchSupplierSessionPage('https://indexer.test', { ...range, suppliers: tooMany })).rejects.toThrow('at most 200')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchSelectionCounts', () => {
  // Captured from data.pocket.network on 2026-10-28: the three suppliers above, base and bsc at 973,641.
  const references = [{ serviceId: 'base', height: 973641 }, { serviceId: 'bsc', height: 973641 }]

  it('counts the eligible configs of our ids only, at the height before the start, and reads the cap at the start', async () => {
    fetchMock.mockResolvedValue(jsonResponse(selectionFixture))
    const counts = await fetchSelectionCounts('https://indexer.test', { suppliers, references })
    expect(counts).toEqual({ ownEligible: { base: 3, bsc: 3 }, caps: { 973641: 50 } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables).toEqual({ suppliers, h0: '973640', v0: 'base', a0: '973641', h1: '973640', v1: 'bsc', a1: '973641', c0: '973641' })
    expect(body.query.match(/supplierId: \{ in: \$suppliers \}/g)).toHaveLength(2)
    // One cap per distinct height, and only counts asked for: no supplier field is read back.
    expect(body.query.match(/params\(/g)).toHaveLength(1)
    expect(body.query).toContain('totalCount')
    expect(body.query).not.toMatch(/nodes \{ (supplierId|id)/)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('splits the aliases into requests of at most 20, and merges the answers', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ serviceId: `svc${i}`, height: i < 40 ? 973641 : 973621 }))
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const { query } = JSON.parse(init.body) as { query: string }
      const data: Record<string, unknown> = {}
      for (const [, alias] of query.matchAll(/ (s\d+): supplierServiceConfigs/g)) data[alias!] = { totalCount: 1 }
      for (const [, alias] of query.matchAll(/ (c\d+): params/g)) data[alias!] = { nodes: [{ value: '50' }] }
      return jsonResponse({ data })
    })
    const counts = await fetchSelectionCounts('https://indexer.test', { suppliers, references: many })
    // 45 counts + 2 caps = 47 aliases: 3 requests.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls) {
      const { query } = JSON.parse(call[1].body) as { query: string }
      expect((query.match(/ [sc]\d+: /g) ?? []).length).toBeLessThanOrEqual(ANALYTICS_MAX_ALIASES)
    }
    expect(Object.keys(counts.ownEligible)).toHaveLength(45)
    expect(counts.caps).toEqual({ 973641: 50, 973621: 50 })
  })

  it('reads no cap without withCaps', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { s0: { totalCount: 3 }, s1: { totalCount: 3 } } }))
    expect(await fetchSelectionCounts('https://indexer.test', { suppliers, references, withCaps: false })).toEqual({ ownEligible: { base: 3, bsc: 3 }, caps: {} })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.query).not.toContain('params(')
    expect(Object.keys(body.variables)).not.toContain('c0')
  })

  it('fails on a missing count or cap instead of storing a zero', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { s0: { totalCount: 3 }, s1: {}, c0: { nodes: [{ value: '50' }] } } }))
    await expect(fetchSelectionCounts('https://indexer.test', { suppliers, references })).rejects.toThrow('no totalCount for service bsc')
    fetchMock.mockResolvedValue(jsonResponse({ data: { s0: { totalCount: 3 }, s1: { totalCount: 3 }, c0: { nodes: [] } } }))
    await expect(fetchSelectionCounts('https://indexer.test', { suppliers, references })).rejects.toThrow('num_suppliers_per_session')
  })

  it('never sends an empty or oversized supplier list, and sends nothing without references', async () => {
    await expect(fetchSelectionCounts('https://indexer.test', { suppliers: [], references })).rejects.toThrow('at least one')
    const tooMany = Array.from({ length: 201 }, (_, i) => `pokt1${i}`)
    await expect(fetchSelectionCounts('https://indexer.test', { suppliers: tooMany, references })).rejects.toThrow('at most 200')
    expect(await fetchSelectionCounts('https://indexer.test', { suppliers, references: [] })).toEqual({ ownEligible: {}, caps: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
