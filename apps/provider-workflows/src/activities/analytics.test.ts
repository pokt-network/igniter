const heartbeat = jest.fn()
const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
// The attempt's cancellation: a test aborts it to stand for an attempt the server already timed out.
let cancellation = new AbortController()
jest.mock('@temporalio/activity', () => ({
  heartbeat: (d: unknown) => heartbeat(d),
  log,
  Context: { current: () => ({ cancellationSignal: cancellation.signal }) },
  ApplicationFailure: { nonRetryable: (msg: string) => new Error(msg) },
}))

const fetchSupplierSessionFunnel = jest.fn()
const fetchSupplierSessionPage = jest.fn()
const fetchSelectionCounts = jest.fn()
jest.mock('@igniter/graphql/analytics', () => ({
  ...jest.requireActual('@igniter/graphql/analytics'),
  fetchSupplierSessionFunnel: (...a: unknown[]) => fetchSupplierSessionFunnel(...a),
  fetchSupplierSessionPage: (...a: unknown[]) => fetchSupplierSessionPage(...a),
  fetchSelectionCounts: (...a: unknown[]) => fetchSelectionCounts(...a),
}))

import { KeyState } from '@igniter/db/provider/enums'
import type { AnalyticsFunnelRow, AnalyticsSessionRow } from '@igniter/graphql/analytics'
import { analyticsActivities } from '@/activities/analytics'

const DAY = '2026-10-20'
const A = 'pokt1aaa'
const B = 'pokt1bbb'
const FOREIGN = 'pokt1zzz'

function makeDal(settings: Record<string, unknown> | null = { indexerApiUrl: 'https://indexer.test', analyticsDayRetentionDays: 90 }) {
  return {
    settings: { loadSettings: jest.fn().mockResolvedValue(settings) },
    keys: { listAnalyticsSuppliers: jest.fn().mockResolvedValue([]) },
    analytics: {
      listDayStates: jest.fn().mockResolvedValue([]),
      replaceSupplierDays: jest.fn().mockResolvedValue(undefined),
      upsertSessionPage: jest.fn().mockResolvedValue(undefined),
      deleteStaleSessionRows: jest.fn().mockResolvedValue(undefined),
      closeInputs: jest.fn().mockResolvedValue({ activeSeats: new Map(), funnelSeats: new Map(), memberRows: new Map(), unsettledSessions: new Map() }),
      upsertDayStates: jest.fn().mockResolvedValue(undefined),
      reopenClosedFrom: jest.fn().mockResolvedValue(0),
      deleteDaysBefore: jest.fn().mockResolvedValue(0),
      markDaySyncing: jest.fn().mockResolvedValue(undefined),
      rebuildDayRollup: jest.fn().mockResolvedValue({ rows: 0, skipped: false }),
      touchDaySyncing: jest.fn().mockResolvedValue(undefined),
      staleRollupDays: jest.fn().mockResolvedValue([]),
      selectionReferenceDays: jest.fn().mockResolvedValue([]),
      selectionReferenceInputs: jest.fn(),
      replaceSelectionReferences: jest.fn().mockResolvedValue(undefined),
    },
  }
}

function funnelRow(supplierId: string, serviceId: string, over: Partial<AnalyticsFunnelRow> = {}): AnalyticsFunnelRow {
  return {
    bucketStart: `${DAY}T00:00:00+00:00`, serviceId, supplierId,
    seats: '3', paid: '1', settledZero: '0', expired: '0', discarded: '0', slashed: '0', idleOthersWorked: '0',
    idleNoWork: '2', unresolved: '0', active: '0', paidUpokt: '10486', equalShareUpokt: '153122', relays: '17',
    computeUnits: '107474', sessionsWithSelected: '3', poolUpokt: '7656098', rosterSeats: '150',
    networkSessions: '142', firstHeight: '972493', lastHeight: '973653',
    ...over,
  }
}

function sessionRow(sessionId: string, startHeight: string, selected: string[]): AnalyticsSessionRow {
  return {
    sessionId, applicationId: 'pokt1app', serviceId: 'akash', startHeight, endHeight: '2', startTime: `${DAY}T10:00:00+00:00`,
    phase: 'settled', settlementHeight: '3', settledHeight: '3', moneyMissing: false, rosterSize: '50', candidates: '4499',
    claimed: '1', paidUpokt: '500', settledUpokt: '500', relays: '1', computeUnits: '1',
    selectedSupplierIds: selected, selectedStates: selected.map(() => 'paid'),
    selectedPaidUpokt: selected.map(() => '10'), selectedEqualShareUpokt: selected.map(() => '10'),
  }
}

const range = { coveredFrom: `${DAY}T00:00:00+00:00`, coveredTo: '2026-10-21T02:00:00+00:00', gaps: [] }

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  jest.setSystemTime(new Date('2026-10-25T10:00:00Z'))
  heartbeat.mockClear()
  log.warn.mockClear()
  fetchSupplierSessionFunnel.mockReset()
  fetchSupplierSessionPage.mockReset()
  fetchSelectionCounts.mockReset()
  cancellation = new AbortController()
})

afterEach(() => jest.useRealTimers())

describe('planAnalyticsSync / planAnalyticsDay', () => {
  it('warns and plans nothing when the indexer URL is not set', async () => {
    const dal = makeDal({ indexerApiUrl: null, analyticsDayRetentionDays: 90 })
    dal.keys.listAnalyticsSuppliers.mockResolvedValue([{ address: A, retiredAt: null }])
    const res = await analyticsActivities(dal as never).planAnalyticsSync({ mode: 'sync' })
    expect(res).toEqual({ indexerConfigured: false, days: [] })
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('reads the verified set from the ever-staked key states only', async () => {
    const dal = makeDal()
    await analyticsActivities(dal as never).planAnalyticsSync({ mode: 'sync' })
    expect(dal.keys.listAnalyticsSuppliers).toHaveBeenCalledWith([
      KeyState.Staked, KeyState.Unstaking, KeyState.Unstaked,
      KeyState.MissingStake, KeyState.AttentionNeeded, KeyState.RemediationFailed,
    ])
  })

  it('caps a sync run to the two newest days plus the open days fetched least recently', async () => {
    const dal = makeDal()
    dal.keys.listAnalyticsSuppliers.mockResolvedValue([{ address: A, retiredAt: null }])
    const days = Array.from({ length: 11 }, (_, i) => `2026-10-${15 + i}`)
    dal.analytics.listDayStates.mockResolvedValue(days.map((day) => ({
      day, supplierId: A, closed: false,
      fetchedAt: new Date(day <= '2026-10-19' ? '2026-10-25T09:00:00Z' : '2026-10-25T01:00:00Z'),
    })))
    const res = await analyticsActivities(dal as never).planAnalyticsSync({ mode: 'sync' })
    expect(res.days).toEqual(['2026-10-15', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  })

  it('splits a day of more than 200 suppliers into batches of at most 200', async () => {
    const dal = makeDal()
    const suppliers = Array.from({ length: 450 }, (_, i) => ({ address: `pokt1${String(i).padStart(3, '0')}`, retiredAt: null }))
    dal.keys.listAnalyticsSuppliers.mockResolvedValue(suppliers)
    const acts = analyticsActivities(dal as never)
    expect(await acts.planAnalyticsSync({ mode: 'sync' })).toEqual({ indexerConfigured: true, days: ['2026-10-25'] })
    const { batches } = await acts.planAnalyticsDay({ mode: 'sync', day: '2026-10-25' })
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50])
    expect(batches.flat()).toEqual(suppliers.map((s) => s.address))
  })
})

describe('syncAnalyticsFunnelDay', () => {
  it('asks for the batch only, measures coverage to day end + 2 h, and writes only the batch\'s rows of the day', async () => {
    fetchSupplierSessionFunnel.mockResolvedValue({
      range,
      rows: [
        funnelRow(A, 'akash'),
        funnelRow(B, 'akash'),
        funnelRow(A, 'arb-one', { networkSessions: '9' }),
        funnelRow(FOREIGN, 'akash'),
        funnelRow(A, 'akash', { bucketStart: '2026-10-21T00:00:00+00:00' }),
      ],
    })
    const dal = makeDal()
    const res = await analyticsActivities(dal as never).syncAnalyticsFunnelDay({ day: DAY, supplierIds: [A, B] })

    expect(fetchSupplierSessionFunnel).toHaveBeenCalledWith('https://indexer.test', {
      suppliers: [A, B],
      rangeStart: '2026-10-20T00:00:00Z',
      rangeEnd: '2026-10-21T02:00:00.000Z',
    })
    const [day, ids, rows, services] = dal.analytics.replaceSupplierDays.mock.calls[0]
    expect(day).toBe(DAY)
    expect(ids).toEqual([A, B])
    expect(rows.map((r: { supplierId: string; serviceId: string }) => `${r.supplierId}/${r.serviceId}`))
      .toEqual([`${A}/akash`, `${B}/akash`, `${A}/arb-one`])
    expect(rows[0]).toMatchObject({ seats: 3, paidUpokt: '10486', poolUpokt: '7656098', rosterSeats: 150, sessionsWithSelected: 3 })
    // network_sessions: once per service, never summed over the suppliers that sat in it.
    expect(services.map((s: { serviceId: string; networkSessions: number }) => [s.serviceId, s.networkSessions]))
      .toEqual([['akash', 142], ['arb-one', 9]])

    expect(res).toEqual({
      rows: 3, services: 2, dropped: 1, coveredFrom: `${DAY}T00:00:00+00:00`, coveredTo: '2026-10-21T02:00:00+00:00', gaps: 0,
    })
    expect(JSON.stringify(res).length).toBeLessThan(300)
  })
})

describe('syncAnalyticsSessionsDay', () => {
  it('pages with the last row as cursor, stops on a short page, and keeps members of the batch only', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => sessionRow(`s${String(1999 - i)}`, String(2000 - i), [A]))
    page1[0] = sessionRow('s1999', '2000', [A, FOREIGN])
    page1[1] = sessionRow('s1998', '1999', [FOREIGN])
    const page2 = [sessionRow('s0999', '1000', [B]), sessionRow('s0998', '999', [A, B])]
    fetchSupplierSessionPage
      .mockResolvedValueOnce({ range, rows: page1 })
      .mockResolvedValueOnce({ range, rows: page2 })
    const dal = makeDal()
    const res = await analyticsActivities(dal as never).syncAnalyticsSessionsDay({ day: DAY, supplierIds: [A, B] })

    expect(fetchSupplierSessionPage).toHaveBeenCalledTimes(2)
    expect(fetchSupplierSessionPage.mock.calls[0][1]).toEqual({
      suppliers: [A, B], rangeStart: '2026-10-20T00:00:00Z', rangeEnd: '2026-10-21T00:00:00Z', before: undefined,
    })
    expect(fetchSupplierSessionPage.mock.calls[1][1].before).toEqual({ height: page1[999]!.startHeight, sessionId: page1[999]!.sessionId })

    const [sessions1, members1] = dal.analytics.upsertSessionPage.mock.calls[0]
    expect(sessions1).toHaveLength(999) // s1998 has only a foreign member: not stored
    expect(members1.every((m: { supplierId: string }) => m.supplierId === A)).toBe(true)
    const [sessions2, members2] = dal.analytics.upsertSessionPage.mock.calls[1]
    expect(sessions2.map((s: { sessionId: string }) => s.sessionId)).toEqual(['s0999', 's0998'])
    expect(members2.map((m: { supplierId: string }) => m.supplierId)).toEqual([B, A, B])
    expect(sessions2[0]).toMatchObject({ day: DAY, paidUpokt: '500', rosterSize: 50, phase: 'settled', moneyMissing: false })

    expect(heartbeat).toHaveBeenCalledTimes(2)
    expect(res).toEqual({ pages: 2, sessions: 1001, members: 1002, dropped: 2 })
    // The stale-row delete keeps exactly the (session, supplier) keys stored by this run, never a time cut.
    const stored = [...members1, ...members2].map((m: { sessionId: string; supplierId: string }) => `${m.sessionId}/${m.supplierId}`)
    const [day, suppliers, keep] = dal.analytics.deleteStaleSessionRows.mock.calls[0]
    expect([day, suppliers]).toEqual([DAY, [A, B]])
    expect(keep.sessionIds.map((s: string, i: number) => `${s}/${keep.supplierIds[i]}`)).toEqual(stored)
  })

  it('writes nothing once the server has cancelled the attempt', async () => {
    fetchSupplierSessionPage.mockImplementation(async () => {
      cancellation.abort()
      return { range, rows: [sessionRow('s1', '1', [A])] }
    })
    const dal = makeDal()
    await expect(analyticsActivities(dal as never).syncAnalyticsSessionsDay({ day: DAY, supplierIds: [A] })).rejects.toThrow()
    expect(dal.analytics.upsertSessionPage).not.toHaveBeenCalled()
    expect(dal.analytics.deleteStaleSessionRows).not.toHaveBeenCalled()
  })

  it('does not run the stale-row delete when cancelled after its last page write', async () => {
    const dal = makeDal()
    dal.analytics.upsertSessionPage.mockImplementation(async () => cancellation.abort())
    fetchSupplierSessionPage.mockResolvedValueOnce({ range, rows: [sessionRow('s1', '1', [A])] })
    await expect(analyticsActivities(dal as never).syncAnalyticsSessionsDay({ day: DAY, supplierIds: [A] })).rejects.toThrow()
    expect(dal.analytics.deleteStaleSessionRows).not.toHaveBeenCalled()
  })
})

describe('closeAnalyticsDay', () => {
  const closeRange = { coveredFrom: `${DAY}T00:00:00+00:00`, coveredTo: '2026-10-21T02:00:00+00:00', gaps: 0 }

  it('keeps every supplier of the batch open when the funnel had dropped rows', async () => {
    const dal = makeDal()
    const res = await analyticsActivities(dal as never).closeAnalyticsDay({ day: DAY, supplierIds: [A, B], ...closeRange, dropped: 1 })
    expect(dal.analytics.upsertDayStates.mock.calls[0][0].map((s: { closed: boolean }) => s.closed)).toEqual([false, false])
    expect(res).toEqual({ closed: 0, open: 2, reopened: 0 })
    // The batch's last write refreshes the day's syncing mark.
    expect(dal.analytics.touchDaySyncing).toHaveBeenCalledWith(DAY)
  })

  it('keeps the day open when the roster history starts after the day start', async () => {
    const dal = makeDal()
    const res = await analyticsActivities(dal as never).closeAnalyticsDay({
      day: DAY, supplierIds: [A], ...closeRange, coveredFrom: `${DAY}T13:00:00+00:00`, dropped: 0,
    })
    expect(res).toEqual({ closed: 0, open: 1, reopened: 0 })
  })

  it('closes per supplier from the stored rows', async () => {
    const dal = makeDal()
    dal.analytics.closeInputs.mockResolvedValue({
      activeSeats: new Map([[B, 1]]),
      funnelSeats: new Map([[A, 5], [B, 6]]),
      memberRows: new Map([[A, 5], [B, 6]]),
      unsettledSessions: new Map(),
    })
    const res = await analyticsActivities(dal as never).closeAnalyticsDay({
      day: DAY, supplierIds: [A, B], ...closeRange, dropped: 0,
    })
    const states = dal.analytics.upsertDayStates.mock.calls[0][0]
    expect(states.map((s: { supplierId: string; closed: boolean }) => [s.supplierId, s.closed])).toEqual([[A, true], [B, false]])
    expect(dal.analytics.reopenClosedFrom).not.toHaveBeenCalled()
    expect(res).toEqual({ closed: 1, open: 1, reopened: 0 })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('keeps a supplier open, and says so, when its member rows are short of its funnel seats', async () => {
    const dal = makeDal()
    dal.analytics.closeInputs.mockResolvedValue({
      activeSeats: new Map(),
      funnelSeats: new Map([[A, 5], [B, 6]]),
      memberRows: new Map([[A, 5], [B, 4]]),
      unsettledSessions: new Map(),
    })
    const res = await analyticsActivities(dal as never).closeAnalyticsDay({ day: DAY, supplierIds: [A, B], ...closeRange, dropped: 0 })
    const states = dal.analytics.upsertDayStates.mock.calls[0][0]
    expect(states.map((s: { supplierId: string; closed: boolean }) => [s.supplierId, s.closed])).toEqual([[A, true], [B, false]])
    expect(res).toEqual({ closed: 1, open: 1, reopened: 0 })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('member rows differ'), expect.objectContaining({
      day: DAY, suppliers: 1, funnelSeats: 6, memberRows: 4,
    }))
  })

  it('reopens the closed days the coverage moved back below', async () => {
    const dal = makeDal()
    dal.analytics.reopenClosedFrom.mockResolvedValue(7)
    const res = await analyticsActivities(dal as never).closeAnalyticsDay({
      day: '2026-10-25', supplierIds: [A], coveredFrom: '2026-10-25T00:00:00+00:00', coveredTo: '2026-10-24T01:00:00+00:00', gaps: 0, dropped: 0,
    })
    expect(dal.analytics.reopenClosedFrom).toHaveBeenCalledWith('2026-10-23')
    expect(res).toEqual({ closed: 0, open: 1, reopened: 7 })
  })
})

describe('pruneAnalyticsDays', () => {
  it('deletes only the days older than the retention setting', async () => {
    const dal = makeDal({ indexerApiUrl: 'https://indexer.test', analyticsDayRetentionDays: 30 })
    dal.analytics.deleteDaysBefore.mockResolvedValue(12)
    const res = await analyticsActivities(dal as never).pruneAnalyticsDays()
    expect(dal.analytics.deleteDaysBefore).toHaveBeenCalledWith('2026-09-26')
    expect(res).toEqual({ before: '2026-09-26', deleted: 12 })
  })
})

describe('day rollups', () => {
  it('marks a day syncing before its sync and rebuilds it after', async () => {
    const dal = makeDal()
    await analyticsActivities(dal as never).markAnalyticsDaySyncing({ day: DAY })
    expect(dal.analytics.markDaySyncing).toHaveBeenCalledWith(DAY)
    dal.analytics.rebuildDayRollup.mockResolvedValue({ rows: 42, skipped: false })
    expect(await analyticsActivities(dal as never).rebuildAnalyticsDayRollup({ day: DAY })).toEqual({ rows: 42 })
    expect(dal.analytics.rebuildDayRollup).toHaveBeenCalledWith(DAY, 'sync')
  })

  it('rebuilds at most `max` stale days per call, oldest first, and says how many remain', async () => {
    const dal = makeDal()
    dal.analytics.staleRollupDays.mockResolvedValue(['2026-10-01', '2026-10-02', '2026-10-03'])
    dal.analytics.rebuildDayRollup.mockResolvedValueOnce({ rows: 3, skipped: false }).mockResolvedValueOnce({ rows: 0, skipped: true })
    expect(await analyticsActivities(dal as never).rebuildStaleAnalyticsDayRollups({ max: 2 })).toEqual({ days: 1, skipped: 1, remaining: 1 })
    expect(dal.analytics.rebuildDayRollup.mock.calls).toEqual([['2026-10-01', 'scheduled'], ['2026-10-02', 'scheduled']])
    dal.analytics.staleRollupDays.mockResolvedValue([])
    dal.analytics.rebuildDayRollup.mockClear()
    expect(await analyticsActivities(dal as never).rebuildStaleAnalyticsDayRollups({ max: 2 })).toEqual({ days: 0, skipped: 0, remaining: 0 })
    expect(dal.analytics.rebuildDayRollup).not.toHaveBeenCalled()
  })
})

describe('syncAnalyticsSelectionReferences', () => {
  const suppliers = Array.from({ length: 250 }, (_, i) => `pokt1${String(i).padStart(3, '0')}`)
  const services = [
    { serviceId: 'base', height: 951501, candidates: 3352 },
    { serviceId: 'bsc', height: 951501, candidates: 4027 },
  ]
  const inputs = { version: 'v1', services, suppliers }

  it('counts the day\'s suppliers in batches of at most 200, reads the caps once, sums per service, and writes under the version', async () => {
    const dal = makeDal()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05', '2026-10-04', '2026-10-03'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue(inputs)
    dal.analytics.replaceSelectionReferences.mockResolvedValue(true)
    fetchSelectionCounts
      .mockResolvedValueOnce({ ownEligible: { base: 190, bsc: 150 }, caps: { 951501: 50 } })
      .mockResolvedValueOnce({ ownEligible: { base: 40, bsc: 10 }, caps: {} })
    const res = await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 1, exclude: ['2026-10-06'] })
    expect(res).toEqual({ days: 1, failed: [], remaining: 2 })
    expect(dal.analytics.selectionReferenceDays).toHaveBeenCalledWith(['2026-10-06'])
    expect(dal.analytics.selectionReferenceInputs).toHaveBeenCalledWith('2026-10-05')
    expect(fetchSelectionCounts.mock.calls.map((c) => [c[1].suppliers.length, c[1].withCaps])).toEqual([[200, true], [50, false]])
    expect(fetchSelectionCounts.mock.calls[0][1].references).toEqual([{ serviceId: 'base', height: 951501 }, { serviceId: 'bsc', height: 951501 }])
    expect(fetchSelectionCounts.mock.calls.flatMap((c) => c[1].suppliers)).toEqual(suppliers)
    const [day, version, rows] = dal.analytics.replaceSelectionReferences.mock.calls[0]
    expect([day, version]).toEqual(['2026-10-05', 'v1'])
    expect(rows).toEqual([
      { day: '2026-10-05', serviceId: 'base', height: 951501, candidates: 3352, cap: 50, ownEligible: 230, version: 'v1', fetchedAt: expect.any(Date) },
      { day: '2026-10-05', serviceId: 'bsc', height: 951501, candidates: 4027, cap: 50, ownEligible: 160, version: 'v1', fetchedAt: expect.any(Date) },
    ])
  })

  it('does not store a service counted above its candidates, and says so', async () => {
    const dal = makeDal()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue({ version: 'v1', services, suppliers: suppliers.slice(0, 10) })
    dal.analytics.replaceSelectionReferences.mockResolvedValue(true)
    fetchSelectionCounts.mockResolvedValueOnce({ ownEligible: { base: 3353, bsc: 10 }, caps: { 951501: 50 } })
    await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })
    const rows = dal.analytics.replaceSelectionReferences.mock.calls[0][2]
    expect(rows.map((r: { serviceId: string }) => r.serviceId)).toEqual(['bsc'])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('more own eligible than candidates'), expect.objectContaining({ day: '2026-10-05' }))
  })

  it('records a day with no verified supplier left as done with no rows, without asking the indexer', async () => {
    const dal = makeDal()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue({ version: 'v1', services, suppliers: [] })
    dal.analytics.replaceSelectionReferences.mockResolvedValue(true)
    expect(await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })).toEqual({ days: 1, failed: [], remaining: 0 })
    expect(fetchSelectionCounts).not.toHaveBeenCalled()
    expect(dal.analytics.replaceSelectionReferences).toHaveBeenCalledWith('2026-10-05', 'v1', [])
  })

  it('records a day whose every service is over its candidates as done with no rows', async () => {
    const dal = makeDal()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue({ version: 'v1', services, suppliers: suppliers.slice(0, 10) })
    dal.analytics.replaceSelectionReferences.mockResolvedValue(true)
    fetchSelectionCounts.mockResolvedValueOnce({ ownEligible: { base: 4000, bsc: 5000 }, caps: { 951501: 50 } })
    expect(await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })).toEqual({ days: 1, failed: [], remaining: 0 })
    expect(dal.analytics.replaceSelectionReferences).toHaveBeenCalledWith('2026-10-05', 'v1', [])
  })

  it('skips a failing day, returns it, and goes on with the next one', async () => {
    const dal = makeDal()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05', '2026-10-04'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue({ version: 'v1', services, suppliers: suppliers.slice(0, 10) })
    dal.analytics.replaceSelectionReferences.mockResolvedValue(true)
    fetchSelectionCounts
      .mockRejectedValueOnce(new Error('Indexer GraphQL request failed with HTTP 502'))
      .mockResolvedValueOnce({ ownEligible: { base: 5, bsc: 5 }, caps: { 951501: 50 } })
    const res = await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })
    expect(res).toEqual({ days: 1, failed: ['2026-10-05'], remaining: 0 })
    expect(dal.analytics.replaceSelectionReferences.mock.calls.map((c) => c[0])).toEqual(['2026-10-04'])
  })

  it('counts a day that changed while counting as not written, and does nothing without pending days', async () => {
    const dal = makeDal()
    expect(await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })).toEqual({ days: 0, failed: [], remaining: 0 })
    expect(fetchSelectionCounts).not.toHaveBeenCalled()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue({ version: 'v1', services, suppliers: suppliers.slice(0, 10) })
    dal.analytics.replaceSelectionReferences.mockResolvedValue(false)
    fetchSelectionCounts.mockResolvedValueOnce({ ownEligible: { base: 5, bsc: 5 }, caps: { 951501: 50 } })
    expect(await analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })).toEqual({ days: 0, failed: [], remaining: 0 })
  })

  it('stops on a cancelled attempt instead of skipping the day', async () => {
    const dal = makeDal()
    dal.analytics.selectionReferenceDays.mockResolvedValue(['2026-10-05'])
    dal.analytics.selectionReferenceInputs.mockResolvedValue({ version: 'v1', services, suppliers: suppliers.slice(0, 10) })
    fetchSelectionCounts.mockImplementationOnce(async () => {
      cancellation.abort()
      throw new Error('aborted')
    })
    await expect(analyticsActivities(dal as never).syncAnalyticsSelectionReferences({ max: 5 })).rejects.toThrow()
    expect(dal.analytics.replaceSelectionReferences).not.toHaveBeenCalled()
  })
})
