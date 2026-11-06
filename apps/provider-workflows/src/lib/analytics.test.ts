import {
  addDays,
  chunk,
  closeThreshold,
  capSyncDays,
  firstDayReopenedBy,
  ANALYTICS_SYNC_MAX_DAYS,
  isAnalyticsDayClosed,
  lastFetchedByDay,
  oldestKeptDay,
  planAnalyticsDays,
  type AnalyticsDayState,
} from '@/lib/analytics'

const today = '2026-10-25'
const A = 'pokt1aaa'
const B = 'pokt1bbb'
const T0 = new Date('2026-10-25T09:00:00Z')

const closedInput = {
  day: '2026-10-20',
  coveredFrom: '2026-10-20T00:00:00+00:00',
  coveredTo: '2026-10-21T02:00:00+00:00',
  gaps: 0,
  dropped: 0,
  activeSeats: 0,
  unsettledSessions: 0,
  funnelSeats: 12,
  memberRows: 12,
}

describe('isAnalyticsDayClosed', () => {
  it('closes when every condition holds', () => {
    expect(isAnalyticsDayClosed(closedInput)).toBe(true)
  })

  it('stays open while covered_to is short of day end + 2 h', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, coveredTo: '2026-10-21T01:59:59.999+00:00' })).toBe(false)
    expect(isAnalyticsDayClosed({ ...closedInput, coveredTo: null })).toBe(false)
  })

  it('stays open while covered_from is null or after the day start (history starts mid-day)', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, coveredFrom: null })).toBe(false)
    expect(isAnalyticsDayClosed({ ...closedInput, coveredFrom: '2026-10-20T00:00:00.001+00:00' })).toBe(false)
    expect(isAnalyticsDayClosed({ ...closedInput, coveredFrom: '2026-10-20T13:00:00+00:00' })).toBe(false)
  })

  it('stays open when the funnel answer had rows outside the batch', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, dropped: 1 })).toBe(false)
  })

  it('stays open while any seat of the day is active', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, activeSeats: 1 })).toBe(false)
  })

  it('stays open while the range has a settlement gap', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, gaps: 1 })).toBe(false)
  })

  it('stays open while a session is not settled or has its money missing', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, unsettledSessions: 1 })).toBe(false)
  })

  it('stays open while its member rows are not exactly its funnel seats (a row lost or left over)', () => {
    expect(isAnalyticsDayClosed({ ...closedInput, memberRows: 11 })).toBe(false)
    expect(isAnalyticsDayClosed({ ...closedInput, memberRows: 13 })).toBe(false)
    expect(isAnalyticsDayClosed({ ...closedInput, funnelSeats: 0, memberRows: 0 })).toBe(true)
  })
})

describe('firstDayReopenedBy', () => {
  const range = (day: string) => ({ rangeStart: `${day}T00:00:00Z`, rangeEnd: closeThreshold(day).toISOString() })

  it('reopens nothing when covered_to reaches the range end (it is clipped there)', () => {
    expect(firstDayReopenedBy(range('2026-10-20'), '2026-10-21T02:00:00+00:00')).toBeNull()
  })

  it('in normal operation only reaches days that cannot be closed yet', () => {
    // Today 10:00, coverage 09:55: yesterday needs coverage to today 02:00, which it has; nothing before today reopens.
    expect(firstDayReopenedBy(range(today), '2026-10-25T09:55:00+00:00')).toBe(today)
  })

  it('reopens the days whose close threshold the coverage fell back below (rewind)', () => {
    // Coverage back at 2026-10-24 01:00: 2026-10-23 needs coverage to 2026-10-24 02:00, so it reopens.
    expect(firstDayReopenedBy(range(today), '2026-10-24T01:00:00+00:00')).toBe('2026-10-23')
    // Exactly at 2026-10-23's threshold it stays closed.
    expect(firstDayReopenedBy(range(today), '2026-10-24T02:00:00+00:00')).toBe('2026-10-24')
  })

  it('reopens nothing on a null covered_to (it does not say where the coverage is)', () => {
    expect(firstDayReopenedBy(range(today), null)).toBeNull()
  })
})

describe('oldestKeptDay', () => {
  it('keeps retentionDays days counting today', () => {
    expect(oldestKeptDay(today, 90)).toBe(addDays(today, -89))
    expect(oldestKeptDay(today, 1)).toBe(today)
  })
})

describe('planAnalyticsDays', () => {
  const plan = (args: Partial<Parameters<typeof planAnalyticsDays>[0]>) =>
    Object.fromEntries(planAnalyticsDays({ suppliers: [], states: [], today, retentionDays: 90, mode: 'sync', ...args }))

  it('a supplier never synced gets today only: there is no automatic backfill', () => {
    expect(plan({ suppliers: [{ address: A, retiredAt: null }] })).toEqual({ [today]: [A] })
  })

  it('sync goes forward from the first day a supplier has a state, skipping closed days', () => {
    const states: AnalyticsDayState[] = [
      { day: '2026-10-21', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-22', supplierId: A, closed: false, fetchedAt: T0 },
      { day: '2026-10-24', supplierId: A, closed: true, fetchedAt: T0 },
    ]
    expect(plan({ suppliers: [{ address: A, retiredAt: null }], states })).toEqual({
      '2026-10-22': [A],
      '2026-10-23': [A],
      [today]: [A],
    })
  })

  it('a supplier added later syncs from its own first run, not from the older suppliers\' days', () => {
    const states: AnalyticsDayState[] = [
      { day: '2026-10-20', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-21', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-22', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-23', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-24', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-24', supplierId: B, closed: false, fetchedAt: T0 },
    ]
    expect(plan({ suppliers: [{ address: A, retiredAt: null }, { address: B, retiredAt: null }], states })).toEqual({
      '2026-10-24': [B],
      [today]: [A, B],
    })
  })

  it('backfill fills only each supplier\'s own missing days of the retention window, oldest first', () => {
    const states: AnalyticsDayState[] = [
      { day: '2026-10-22', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-23', supplierId: A, closed: true, fetchedAt: T0 },
      { day: '2026-10-24', supplierId: A, closed: false, fetchedAt: T0 },
      { day: today, supplierId: A, closed: false, fetchedAt: T0 },
      { day: '2026-10-24', supplierId: B, closed: false, fetchedAt: T0 },
      { day: today, supplierId: B, closed: false, fetchedAt: T0 },
    ]
    const result = planAnalyticsDays({
      suppliers: [{ address: A, retiredAt: null }, { address: B, retiredAt: null }],
      states,
      today,
      retentionDays: 5,
      mode: 'backfill',
    })
    expect([...result.keys()]).toEqual(['2026-10-21', '2026-10-22', '2026-10-23'])
    expect(Object.fromEntries(result)).toEqual({
      '2026-10-21': [A, B],
      '2026-10-22': [B],
      '2026-10-23': [B],
    })
  })

  it('a retired key gets no day after its retirement, in sync or backfill', () => {
    const retiredAt = new Date('2026-10-23T15:00:00Z')
    const states: AnalyticsDayState[] = [{ day: '2026-10-22', supplierId: A, closed: true, fetchedAt: T0 }]
    expect(plan({ suppliers: [{ address: A, retiredAt }], states })).toEqual({ '2026-10-23': [A] })
    expect(plan({ suppliers: [{ address: A, retiredAt }], states, retentionDays: 4, mode: 'backfill' })).toEqual({
      '2026-10-23': [A],
    })
    // Retired before it was ever synced: nothing new.
    expect(plan({ suppliers: [{ address: B, retiredAt }] })).toEqual({})
  })

  it('never plans a day older than the retention window', () => {
    const states: AnalyticsDayState[] = [{ day: '2026-01-01', supplierId: A, closed: false, fetchedAt: T0 }]
    const result = planAnalyticsDays({ suppliers: [{ address: A, retiredAt: null }], states, today, retentionDays: 3, mode: 'sync' })
    expect([...result.keys()]).toEqual(['2026-10-23', '2026-10-24', today])
  })
})

describe('chunk', () => {
  it('splits a day of 450 suppliers into batches of at most 200, in order', () => {
    const ids = Array.from({ length: 450 }, (_, i) => `pokt1${String(i).padStart(3, '0')}`)
    const batches = chunk(ids, 200)
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50])
    expect(batches.flat()).toEqual(ids)
  })
})

describe('capSyncDays', () => {
  const days = Array.from({ length: 10 }, (_, i) => addDays('2026-10-01', i))

  const at = (hour: number) => Date.UTC(2026, 9, 25, hour)

  it('keeps every day up to the cap', () => {
    expect(capSyncDays(days.slice(0, ANALYTICS_SYNC_MAX_DAYS), new Map())).toEqual(days.slice(0, ANALYTICS_SYNC_MAX_DAYS))
  })

  it('past the cap keeps the two newest, then the open days fetched least recently, never-fetched first', () => {
    // The 5 oldest were fetched last (hours 9..5); days[5] was never fetched; days[6], days[7] long ago.
    const fetched = new Map<string, number>([
      [days[0]!, at(9)], [days[1]!, at(8)], [days[2]!, at(7)], [days[3]!, at(6)], [days[4]!, at(5)],
      [days[6]!, at(1)], [days[7]!, at(2)], [days[8]!, at(9)], [days[9]!, at(9)],
    ])
    expect(capSyncDays(days, fetched)).toEqual([days[3], days[4], days[5], days[6], days[7], days[8], days[9]])
  })

  it('never-fetched middle days go before the days fetched most recently', () => {
    const first = capSyncDays(days, new Map(days.slice(0, 5).map((d, i) => [d, at(i)])))
    expect(first).toEqual([days[5], days[6], days[7], days[0], days[1], days[8], days[9]].sort())
  })
})

describe('lastFetchedByDay', () => {
  it('takes the latest fetch over the planned suppliers only; a day none of them fetched is absent', () => {
    const states: AnalyticsDayState[] = [
      { day: '2026-10-20', supplierId: A, closed: false, fetchedAt: new Date(1000) },
      { day: '2026-10-20', supplierId: B, closed: false, fetchedAt: new Date(3000) },
      { day: '2026-10-21', supplierId: B, closed: true, fetchedAt: new Date(9000) },
    ]
    const plan = new Map([['2026-10-20', [A, B]], ['2026-10-21', [A]]])
    expect(lastFetchedByDay(plan, states)).toEqual(new Map([['2026-10-20', 3000]]))
  })
})
