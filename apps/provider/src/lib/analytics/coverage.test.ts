import { chartsByDay, clampAnalyticsRange, coverageOf, defaultPeriodDays, periodWeeks, weekRangeLabel, analyticsPeriod, analyticsRangeBounds, missingDayPairs, periodOptions } from './coverage'

describe('missingDayPairs', () => {
  const suppliers = [
    { address: 'pokt1a', retiredAt: null },
    { address: 'pokt1b', retiredAt: null },
    { address: 'pokt1r', retiredAt: new Date('2026-10-23T12:00:00Z') },
  ]

  it('counts the (day, supplier) pairs with no state row, and the days that have one', () => {
    const res = missingDayPairs({
      suppliers,
      coverage: [{ day: '2026-10-23', states: 3, closed: true }, { day: '2026-10-25', states: 1, closed: false }],
      from: '2026-10-23',
      to: '2026-10-25',
    })
    // 10-23: all 3 stored. 10-24: a and b missing (r retired on 10-23). 10-25: one of a, b missing.
    expect(res).toEqual({ pairs: 3, days: 2 })
  })

  it('nothing missing when every expected supplier has a state', () => {
    expect(missingDayPairs({
      suppliers: suppliers.slice(0, 2),
      coverage: [{ day: '2026-10-24', states: 2, closed: true }],
      from: '2026-10-24',
      to: '2026-10-24',
    })).toEqual({ pairs: 0, days: 0 })
  })
})

describe('coverageOf', () => {
  it('the last day fully closed, and the days with an open state', () => {
    expect(coverageOf([
      { day: '2026-10-23', states: 3, closed: true },
      { day: '2026-10-24', states: 3, closed: true },
      { day: '2026-10-25', states: 3, closed: false },
    ])).toEqual({ lastClosedDay: '2026-10-24', openDays: 1 })
    expect(coverageOf([])).toEqual({ lastClosedDay: null, openDays: 0 })
  })
})

describe('period', () => {
  it('is the last N days counting today, capped by retention', () => {
    expect(analyticsPeriod('2026-10-25', 7, 90)).toEqual({ from: '2026-10-19', to: '2026-10-25', days: 7 })
    expect(analyticsPeriod('2026-10-25', 90, 3)).toEqual({ from: '2026-10-23', to: '2026-10-25', days: 3 })
  })

  it('offers 7, 30 and 90 days, capped by retention', () => {
    expect(periodOptions(90)).toEqual([7, 30, 90])
    expect(periodOptions(365)).toEqual([7, 30, 90])
    expect(periodOptions(45)).toEqual([7, 30, 45])
    expect(periodOptions(3)).toEqual([3])
  })

  it('opens on the last 7 days, or the whole retention when shorter, always one of the options', () => {
    expect(defaultPeriodDays(90)).toBe(7)
    expect(defaultPeriodDays(7)).toBe(7)
    expect(defaultPeriodDays(3)).toBe(3)
    expect(defaultPeriodDays(1)).toBe(1)
    for (const r of [1, 3, 7, 45, 90, 365]) expect(periodOptions(r)).toContain(defaultPeriodDays(r))
  })
})

describe('custom range bounds', () => {
  const bounds = { today: '2026-10-25', retentionDays: 90, oldestDataDay: '2026-10-23' }

  it('cannot start before the oldest stored day nor end after today', () => {
    expect(analyticsRangeBounds(bounds)).toEqual({ min: '2026-10-23', max: '2026-10-25' })
    expect(clampAnalyticsRange({ from: '2026-01-01', to: '2027-01-01' }, bounds)).toEqual({ from: '2026-10-23', to: '2026-10-25', days: 3 })
  })

  it('never before the retention window, even with older data', () => {
    const b = { today: '2026-10-25', retentionDays: 3, oldestDataDay: '2026-09-01' }
    expect(analyticsRangeBounds(b)).toEqual({ min: '2026-10-23', max: '2026-10-25' })
  })

  it('no stored data: the retention window', () => {
    expect(analyticsRangeBounds({ today: '2026-10-25', retentionDays: 7, oldestDataDay: null })).toEqual({ min: '2026-10-19', max: '2026-10-25' })
  })

  it('keeps from <= to, and one day is a range', () => {
    expect(clampAnalyticsRange({ from: '2026-10-25', to: '2026-10-24' }, bounds)).toEqual({ from: '2026-10-24', to: '2026-10-24', days: 1 })
    expect(clampAnalyticsRange({ from: '2026-10-24', to: '2026-10-24' }, bounds)).toEqual({ from: '2026-10-24', to: '2026-10-24', days: 1 })
  })

  it('rejects a malformed day', () => {
    expect(clampAnalyticsRange({ from: '24/10/2026', to: '2026-10-25' }, bounds)).toBeNull()
    expect(clampAnalyticsRange({ from: '2026-13-40', to: '2026-10-25' }, bounds)).toBeNull()
  })

  it('labels a week by its range clipped to the period', () => {
    expect(weekRangeLabel('2026-09-07', '2026-09-01', '2026-10-25')).toBe('7–13 Sep')
    expect(weekRangeLabel('2026-09-07', '2026-09-10', '2026-10-25')).toBe('10–13 Sep')
    expect(weekRangeLabel('2026-09-28', '2026-09-01', '2026-10-25')).toBe('28 Sep–4 Oct')
    expect(weekRangeLabel('2026-10-19', '2026-09-01', '2026-10-22')).toBe('19–22 Oct')
    expect(weekRangeLabel('2026-10-19', '2026-09-01', '2026-10-19')).toBe('19 Oct')
  })

  it('charts short periods by day and long ones by week', () => {
    expect(chartsByDay('2026-10-19', '2026-10-25')).toBe(true)
    expect(chartsByDay('2026-10-12', '2026-10-25')).toBe(true)
    expect(chartsByDay('2026-10-11', '2026-10-25')).toBe(false)
    expect(chartsByDay('2026-09-06', '2026-10-05')).toBe(false)
  })

  it('cuts a period into 7-day blocks from its first day, the last one clipped', () => {
    expect(periodWeeks('2026-09-06', '2026-10-05').map((w) => w.label)).toEqual([
      '6–12 Sep', '13–19 Sep', '20–26 Sep', '27 Sep–3 Oct', '4–5 Oct',
    ])
    expect(periodWeeks('2026-10-19', '2026-10-25')).toEqual([{ start: '2026-10-19', end: '2026-10-25', label: '19–25 Oct' }])
  })
})
