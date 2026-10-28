import { bootstrapF, decimalString, hasRangeEvidence, RANGE_MIN_DAYS, RANGE_MIN_SESSIONS, percentVsEqualShare, ratio, roundDiv, seededRandom, summarize, type DayServiceTotals } from './math'

const row = (over: Partial<DayServiceTotals>): DayServiceTotals => ({
  day: '2026-10-24', serviceId: 'akash', paidUpokt: '0', equalShareUpokt: '0', seats: 0, paid: 0,
  sessions: 0, positiveSessions: 0, poolUpokt: '0', rosterSeats: 0, members: 0, networkSessions: 0, ...over,
})

const CLOSED = new Set(['2026-10-24'])

describe('summarize', () => {
  // The live e2e day 2026-10-24 (2,721 nodefleet.net suppliers, all services), split over two services.
  const day = [
    row({ serviceId: 'akash', paidUpokt: '201000000000', equalShareUpokt: '287000000000', seats: 185000, paid: 115000,
      sessions: 5300, poolUpokt: '468000000000', rosterSeats: 265000, members: 185000, networkSessions: 5306 }),
    row({ serviceId: 'bsc', paidUpokt: '404073796', equalShareUpokt: '469909057', seats: 444, paid: 10,
      sessions: 14, poolUpokt: '952967525', rosterSeats: 700, members: 444, networkSessions: 14 }),
  ]

  it('F = ΣY / ΣB, exact on upokt totals', () => {
    const s = summarize(day, CLOSED)
    expect(s.y).toBe('201404073796')
    expect(s.b).toBe('287469909057')
    expect(s.f).toBeCloseTo(0.7006092, 6)
    expect(s.percentVsEqualShare).toBeCloseTo(-29.939, 2)
  })

  it('presence = distinct own sessions / network sessions; mean selected = members / sessions', () => {
    const s = summarize(day, CLOSED)
    expect(s.sessions).toBe(5314)
    expect(s.networkSessions).toBe(5320)
    expect(s.presence).toBeCloseTo(5314 / 5320, 10)
    expect(s.meanSelected).toBeCloseTo(185444 / 5314, 10)
    expect(s.poolUpokt).toBe('468952967525')
    expect(s.rosterSeats).toBe(265700)
  })

  it('presence and mean selected use closed days only, and never exceed 100%', () => {
    // An open day whose session list ran ahead of the funnel's network_sessions.
    const open = row({ day: '2026-10-25', sessions: 400, networkSessions: 300, members: 4000 })
    const s = summarize([...day, open], CLOSED)
    expect(s.sessions).toBe(5714)
    expect(s.presenceDays).toBe(1)
    expect(s.presence).toBeCloseTo(5314 / 5320, 10)
    expect((s.presence! * 100).toFixed(2)).toBe('99.89')
    expect(s.meanSelected).toBeCloseTo(185444 / 5314, 10)
    expect(s.presenceErrorDays).toEqual([])

    // A closed day above its network sessions is a data error: flagged, and clamped.
    const bad = summarize([row({ sessions: 10, networkSessions: 8, members: 10 })], CLOSED)
    expect(bad.presence).toBe(1)
    expect(bad.presenceErrorDays).toEqual(['2026-10-24'])

    // No closed day: no presence yet.
    expect(summarize([open], CLOSED).presence).toBeNull()
  })

  it('per service', () => {
    const s = summarize([...day, row({ day: '2026-10-26', paidUpokt: '5', equalShareUpokt: '10', sessions: 1, networkSessions: 2 })], CLOSED)
    expect(s.services.map((x) => x.serviceId)).toEqual(['akash', 'bsc'])
    expect(s.services[0]).toMatchObject({ y: '201000000005', b: '287000000010', sessions: 5301, days: 2 })
    expect(s.days).toBe(2)
  })

  it('no equal share gives no F', () => {
    expect(summarize([row({})], CLOSED).f).toBeNull()
    expect(ratio(1n, 0n)).toBeNull()
    expect(percentVsEqualShare(null)).toBeNull()
  })
})

describe('the 95% range gate', () => {
  // N days with an equal share, `perDay` positive sessions each, alternating F so the range is not degenerate.
  const days = (n: number, perDay: number) => Array.from({ length: n }, (_, i) => row({
    day: `2026-10-${String(i + 1).padStart(2, '0')}`, paidUpokt: i % 2 ? '90' : '110', equalShareUpokt: '100',
    sessions: perDay, positiveSessions: perDay,
  }))
  const closed = (n: number) => new Set(Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`))

  it('needs 7 days with an equal share and 24 sessions with one, as @mykyal\'s fleet analysis', () => {
    expect([RANGE_MIN_DAYS, RANGE_MIN_SESSIONS]).toEqual([7, 24])
    expect(hasRangeEvidence(7, 24)).toBe(true)
    expect(hasRangeEvidence(6, 1000)).toBe(false)
    expect(hasRangeEvidence(30, 23)).toBe(false)
  })

  it('gives no range below the gate, and says why', () => {
    const two = summarize(days(2, 100), closed(2))
    expect(two.f).toBe(1)
    expect(two.range).toBeNull()
    expect(two.rangeEvidence).toEqual({ informativeDays: 2, positiveSessions: 200, enough: false })
    const few = summarize(days(10, 2), closed(10))
    expect(few.range).toBeNull()
    expect(few.rangeEvidence).toEqual({ informativeDays: 10, positiveSessions: 20, enough: false })
  })

  it('gives the range at the gate', () => {
    const s = summarize(days(7, 4), closed(7))
    expect(s.rangeEvidence).toEqual({ informativeDays: 7, positiveSessions: 28, enough: true })
    expect(s.range).not.toBeNull()
  })

  it('counts only days with an equal share', () => {
    const s = summarize([...days(6, 10), row({ day: '2026-10-20', paidUpokt: '5', equalShareUpokt: '0', sessions: 9 })], closed(6))
    expect(s.rangeEvidence.informativeDays).toBe(6)
    expect(s.range).toBeNull()
  })
})

describe('exact rounding', () => {
  it('roundDiv rounds half away from zero', () => {
    expect([roundDiv(5n, 2n), roundDiv(7n, 2n), roundDiv(4n, 3n), roundDiv(5n, 3n)]).toEqual([3n, 4n, 1n, 2n])
    expect([roundDiv(-5n, 2n), roundDiv(5n, -2n), roundDiv(-4n, 3n)]).toEqual([-3n, -3n, -1n])
  })

  it('decimalString is exact at the .5 boundaries and on amounts past 2^53', () => {
    expect(decimalString(1n, 8n, 2)).toBe('0.13') // 0.125
    expect(decimalString(-1n, 8n, 2)).toBe('-0.13')
    expect(decimalString(1n, 3n, 6)).toBe('0.333333')
    expect(decimalString(2n, 3n, 6)).toBe('0.666667')
    expect(decimalString(10n, 2n, 0)).toBe('5')
    expect(decimalString(-1n, 1000n, 2)).toBe('0.00') // rounds to zero: no "-0.00"
    // An exact 5 in the 7th decimal of a ratio of totals past 2^53, and one unit below it.
    const d = 10n ** 28n
    expect(decimalString(12345n * 10n ** 21n, d, 6)).toBe('0.001235') // 0.0012345
    expect(decimalString(12345n * 10n ** 21n - 1n, d, 6)).toBe('0.001234')
  })

  it('ratio rounds at 9 decimals instead of truncating', () => {
    expect(ratio(2n, 3n)).toBe(0.666666667)
    expect(ratio(-2n, 3n)).toBe(-0.666666667)
  })
})

describe('bootstrapF', () => {
  const days = [
    { y: 70n, b: 100n }, { y: 60n, b: 100n }, { y: 90n, b: 100n }, { y: 75n, b: 100n }, { y: 50n, b: 100n },
  ]

  it('is deterministic for a fixed seed and brackets F', () => {
    const a = bootstrapF(days)
    expect(a).toEqual(bootstrapF(days))
    expect(a!.low).toBeLessThanOrEqual(0.69)
    expect(a!.high).toBeGreaterThanOrEqual(0.69)
    expect(a!.low).toBeGreaterThanOrEqual(0.5)
    expect(a!.high).toBeLessThanOrEqual(0.9)
  })

  it('pins the range for seed 1 and 2000 resamples (a change in the resampling shows here)', () => {
    expect(bootstrapF(days, 2000, 1)).toEqual({ low: 0.58, high: 0.81 })
  })

  it('needs two days with an equal share', () => {
    expect(bootstrapF([{ y: 1n, b: 2n }])).toBeNull()
    expect(bootstrapF([{ y: 1n, b: 2n }, { y: 1n, b: 0n }])).toBeNull()
  })

  it('seededRandom repeats its sequence', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

