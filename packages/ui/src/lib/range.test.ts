import { coverageNote, isFailedTotal, isUncovered, maskUncoveredBuckets, parseTime, unwrapRange } from './range'
import { combineRewardRows, combineRewardsWindows, mergeRewardRows, sumRewardTotals } from './rewards'

// Shapes from the indexer's range contract (pocketdex RESULT.md, "Contract as implemented")
const partialRange = {
  requested_from: '2026-08-31T00:00:00+00:00',
  requested_to: '2026-09-01T13:00:00+00:00',
  covered_from: '2026-09-01T12:00:00+00:00',
  covered_to: '2026-09-01T13:00:00+00:00',
  gaps: [],
}
const gapRange = {
  requested_from: '2026-08-31T00:00:00+00:00',
  requested_to: '2026-09-03T00:00:00+00:00',
  covered_from: '2026-09-01T12:00:00+00:00',
  covered_to: '2026-09-02T08:20:00+00:00',
  gaps: [{ from: '2026-09-01T23:30:00+00:00', to: '2026-09-02T00:00:00+00:00' }],
}
// A series function's answer for a covered window with no rows: data null, covered bounds set
const coveredNoRows = { ...partialRange, requested_from: partialRange.covered_from }
const fullRange = { ...partialRange, requested_from: '2026-09-01T12:00:00+00:00' }
// The indexer's current wording: nothing covered gives covered_from / covered_to null
const notCovered = { ...partialRange, covered_from: null, covered_to: null }


describe('unwrapRange', () => {
  it('reads the new shape', () => {
    expect(unwrapRange({ range: partialRange, data: 201156529 })).toEqual({ data: 201156529, range: partialRange })
  })

  it('keeps data null as null, never 0', () => {
    expect(unwrapRange({ range: coveredNoRows, data: null })).toEqual({ data: null, range: coveredNoRows })
    expect(unwrapRange({ range: notCovered, data: null })).toEqual({ data: null, range: notCovered })
  })

  it('passes the old shape through with no range', () => {
    expect(unwrapRange('5955402106')).toEqual({ data: '5955402106', range: null })
    expect(unwrapRange(0)).toEqual({ data: 0, range: null })
    expect(unwrapRange(null)).toEqual({ data: null, range: null })
    const old = [{ address: 'pokt1a', date_truncated: '2026-09-01T00:00:00', total_amount: 1 }]
    expect(unwrapRange(old)).toEqual({ data: old, range: null })
  })
})

describe('sumRewardTotals and mergeRewardRows', () => {
  it('sums old-shape numeric strings exactly as before', () => {
    expect(sumRewardTotals(['1000000', '2000000'])).toEqual({ data: 3000000, range: null })
    expect(sumRewardTotals(['1000000', null])).toEqual({ data: 1000000, range: null })
    expect(sumRewardTotals(['0'])).toEqual({ data: 0, range: null })
  })

  it('sums new-shape data and keeps the range', () => {
    expect(sumRewardTotals([{ range: partialRange, data: 100 }, { range: partialRange, data: '25' }])).toEqual({
      data: 125,
      range: partialRange,
    })
  })

  it('gives data null when no batch has data, and skips the batches without it', () => {
    expect(sumRewardTotals([{ range: coveredNoRows, data: null }, { range: coveredNoRows, data: null }])).toEqual({
      data: null,
      range: coveredNoRows,
    })
    expect(sumRewardTotals([{ range: notCovered, data: null }, { range: notCovered, data: null }])).toEqual({
      data: null,
      range: notCovered,
    })
    expect(sumRewardTotals([{ range: partialRange, data: null }, { range: partialRange, data: 0 }])).toEqual({
      data: 0,
      range: partialRange,
    })
  })

  it('merges new-shape rows per (address, date) and the gaps of every batch', () => {
    const a = { range: gapRange, data: [{ address: 'pokt1a', date_truncated: '2026-09-01T00:00:00', total_amount: 100 }] }
    const otherGap = { from: '2026-09-02T02:00:00+00:00', to: '2026-09-02T03:00:00+00:00' }
    const b = {
      range: {
        ...gapRange,
        covered_from: '2026-09-01T13:00:00+00:00',
        covered_to: '2026-09-02T08:00:00+00:00',
        gaps: [...gapRange.gaps, otherGap],
      },
      data: [{ address: 'pokt1a', date_truncated: '2026-09-01T00:00:00', total_amount: 30 }],
    }
    expect(mergeRewardRows([a, b])).toEqual({
      data: [{ address: 'pokt1a', date_truncated: '2026-09-01T00:00:00', total_amount: 130 }],
      range: {
        ...gapRange,
        covered_from: '2026-09-01T13:00:00+00:00',
        covered_to: '2026-09-02T08:00:00+00:00',
        gaps: [...gapRange.gaps, otherGap],
      },
    })
  })

  it('reads a mix of both shapes, as while the indexer release rolls out', () => {
    expect(sumRewardTotals(['5000000', { range: partialRange, data: '3000000' }])).toEqual({
      data: 8000000,
      range: partialRange,
    })
    expect(sumRewardTotals([null, { range: notCovered, data: null }])).toEqual({ data: null, range: notCovered })
  })

  it('merges old-shape rows exactly as before', () => {
    expect(mergeRewardRows([[{ address: 'pokt1a', date_truncated: 'd', total_amount: '2' }], null])).toEqual({
      data: [{ address: 'pokt1a', date_truncated: 'd', total_amount: '2' }],
      range: null,
    })
    // the old empty answer (null) stays no rows in every batch count
    expect(mergeRewardRows([null])).toEqual({ data: null, range: null })
    expect(mergeRewardRows([null, null])).toEqual({ data: null, range: null })
  })
})

describe('coverageNote', () => {
  it('says nothing for the old shape or a fully covered window', () => {
    expect(coverageNote(null)).toBeNull()
    expect(coverageNote(fullRange)).toBeNull()
  })

  it('names the coverage start when it is after the requested start', () => {
    expect(coverageNote(partialRange)).toBe('Data since Sep 01, 2026, 12:00 UTC')
  })

  it('says nothing is covered when covered_from and covered_to are null', () => {
    expect(coverageNote(notCovered)).toBe('No indexed data for this range')
  })

  it('never decides "not covered" from data alone: a covered window with no rows has no note', () => {
    expect(coverageNote(unwrapRange({ range: coveredNoRows, data: null }).range)).toBeNull()
    const merged = mergeRewardRows([{ range: coveredNoRows, data: null }, { range: coveredNoRows, data: null }])
    expect(merged).toEqual({ data: null, range: coveredNoRows })
    expect(isUncovered(merged.range)).toBe(false)
    expect(coverageNote(merged.range)).toBeNull()
  })

  it('clips the gaps to the window and reads open-ended edges', () => {
    const range = { ...fullRange, end_inclusive: true }
    expect(coverageNote({ ...range, gaps: [{ from: '2026-09-01T12:30:00+00:00', to: '2026-09-02T00:00:00+00:00' }] }))
      .toBe('gaps: Sep 01, 2026, 12:30 UTC – Sep 01, 2026, 13:00 UTC')
    expect(coverageNote({ ...range, gaps: [{ from: '2026-09-01T12:30:00+00:00', to: null }] }))
      .toBe('gaps: Sep 01, 2026, 12:30 UTC – Sep 01, 2026, 13:00 UTC')
    expect(coverageNote({ ...range, gaps: [{ from: null, to: '2026-09-01T12:15:00+00:00' }] }))
      .toBe('gaps: Sep 01, 2026, 12:00 UTC – Sep 01, 2026, 12:15 UTC')
    expect(coverageNote({ ...range, gaps: [{ from: '2026-09-01T14:00:00+00:00', to: '2026-09-01T15:00:00+00:00' }] }))
      .toBeNull()
  })

  it('leaves out a gap that ends where the data starts, and caps the list', () => {
    const leading = { from: '2026-08-30T00:00:00+00:00', to: partialRange.covered_from }
    expect(coverageNote({ ...partialRange, gaps: [leading] })).toBe('Data since Sep 01, 2026, 12:00 UTC')
    const gap = (h: number) => ({ from: `2026-09-01T${h}:00:00+00:00`, to: `2026-09-01T${h}:30:00+00:00` })
    expect(coverageNote({ ...fullRange, requested_to: '2026-09-02T00:00:00+00:00', covered_to: '2026-09-02T00:00:00+00:00', gaps: [gap(13), gap(14), gap(15), gap(16), gap(17)] })).toBe(
      'gaps: Sep 01, 2026, 13:00 UTC – Sep 01, 2026, 13:30 UTC, Sep 01, 2026, 14:00 UTC – Sep 01, 2026, 14:30 UTC, ' +
        'Sep 01, 2026, 15:00 UTC – Sep 01, 2026, 15:30 UTC, 2 more',
    )
  })

  it('reads the microseconds Postgres prints', () => {
    expect(coverageNote({ ...fullRange, requested_from: '2026-09-01T00:00:00+00:00', covered_from: '2026-09-01T12:00:03.412345+00:00' }))
      .toBe('Data since Sep 01, 2026, 12:00 UTC')
  })

  it('prints midnight as 00:00', () => {
    expect(coverageNote({ ...fullRange, requested_from: '2026-09-01T00:00:00Z', covered_from: '2026-09-02T00:00:00Z' }))
      .toBe('Data since Sep 02, 2026, 00:00 UTC')
  })

  it('lists the gaps', () => {
    expect(coverageNote(gapRange)).toBe(
      'Data since Sep 01, 2026, 12:00 UTC; gaps: Sep 01, 2026, 23:30 UTC – Sep 02, 2026, 00:00 UTC',
    )
    expect(coverageNote({ ...gapRange, requested_from: gapRange.covered_from })).toBe(
      'gaps: Sep 01, 2026, 23:30 UTC – Sep 02, 2026, 00:00 UTC',
    )
  })
})

describe('combineRewardsWindows and combineRewardRows', () => {
  it('normalise every batch result of a document to Ranged', () => {
    expect(combineRewardsWindows([{ last24h: '1', last48h: '2' }, { last24h: '3', last48h: '4' }])).toEqual({
      last24h: { data: 4, range: null },
      last48h: { data: 6, range: null },
    })
    expect(combineRewardsWindows([{ last24h: { range: notCovered, data: null }, last48h: { range: partialRange, data: 7 } }]))
      .toEqual({ last24h: { data: null, range: notCovered }, last48h: { data: 7, range: partialRange } })
    const row = { address: 'pokt1a', date_truncated: '2026-09-01T00:00:00', total_amount: 5 }
    expect(combineRewardRows([{ rewards: { range: gapRange, data: [row] } }])).toEqual({ data: [row], range: gapRange })
  })
})

describe('scalar totals as JSON strings', () => {
  it('sums data sent as a numeric string, as the new legacy_ scalars do', () => {
    expect(combineRewardsWindows([
      { last24h: { range: partialRange, data: '201156529' }, last48h: { range: partialRange, data: '402313058' } },
      { last24h: { range: partialRange, data: '1' }, last48h: { range: partialRange, data: '0' } },
    ])).toEqual({
      last24h: { data: 201156530, range: partialRange },
      last48h: { data: 402313058, range: partialRange },
    })
  })
})

describe('isFailedTotal', () => {
  it('is an error or a null total over a covered window, never an uncovered one', () => {
    expect(isFailedTotal(null)).toBe(true)
    expect(isFailedTotal({ data: null, range: null })).toBe(true)
    expect(isFailedTotal({ data: null, range: partialRange })).toBe(true)
    expect(isFailedTotal({ data: null, range: notCovered })).toBe(false)
    expect(isFailedTotal({ data: 0, range: partialRange })).toBe(false)
    expect(isFailedTotal({ data: '5', range: null })).toBe(false)
  })
})

describe('isUncovered', () => {
  it('is true only for null covered bounds, never for data', () => {
    expect(isUncovered(notCovered)).toBe(true)
    expect(isUncovered(coveredNoRows)).toBe(false)
    expect(isUncovered(partialRange)).toBe(false)
    expect(isUncovered(null)).toBe(false)
  })
})

describe('formatting', () => {
  it('prints a fixed UTC text, the same on the server and in the browser', () => {
    expect(coverageNote({ ...fullRange, requested_from: '2026-01-01T00:00:00Z', covered_from: '2026-01-05T07:09:00Z' }))
      .toBe('Data since Jan 05, 2026, 07:09 UTC')
    expect(coverageNote({ ...fullRange, requested_from: '2026-12-01T00:00:00Z', covered_from: '2026-12-31T23:59:59.999Z' }))
      .toBe('Data since Dec 31, 2026, 23:59 UTC')
  })
})

describe('parseTime', () => {
  it('reads 0 to 6 fractional digits as milliseconds', () => {
    const base = Date.UTC(2026, 8, 1, 12, 0, 3)
    expect(parseTime('2026-09-01T12:00:03+00:00').getTime()).toBe(base)
    expect(parseTime('2026-09-01T12:00:03.5+00:00').getTime()).toBe(base + 500)
    expect(parseTime('2026-09-01T12:00:03.12+00:00').getTime()).toBe(base + 120)
    expect(parseTime('2026-09-01T12:00:03.123+00:00').getTime()).toBe(base + 123)
    expect(parseTime('2026-09-01T12:00:03.123456+00:00').getTime()).toBe(base + 123)
    expect(parseTime('2026-09-01T12:00:03.5Z').getTime()).toBe(base + 500)
  })

  it('reads the Postgres text form', () => {
    expect(parseTime('2026-10-04 12:00:00+00').getTime()).toBe(Date.UTC(2026, 9, 4, 12))
    expect(parseTime('2026-10-04 12:00:00.25+00').getTime()).toBe(Date.UTC(2026, 9, 4, 12, 0, 0, 250))
    expect(parseTime('2026-10-05').getTime()).toBe(Date.UTC(2026, 9, 5))
    expect(coverageNote({ ...fullRange, requested_from: '2026-10-04 00:00:00+00', covered_from: '2026-10-04 12:00:00+00' }))
      .toBe('Data since Oct 04, 2026, 12:00 UTC')
  })

  it('treats a time that does not parse as unknown: no "Data since", no clipping, printed as sent', () => {
    expect(coverageNote({ ...fullRange, covered_from: 'garbage' })).toBeNull()
    expect(coverageNote({ ...fullRange, requested_from: 'garbage', covered_from: '2026-09-01T12:00:00Z' })).toBeNull()
    expect(coverageNote({ ...fullRange, gaps: [{ from: 'garbage', to: '2026-09-01T12:30:00Z' }] }))
      .toBe('gaps: garbage – Sep 01, 2026, 12:30 UTC')
    expect(coverageNote({ ...fullRange, covered_to: 'garbage', gaps: [{ from: '2026-09-01T12:30:00Z', to: '2026-09-02T00:00:00Z' }] }))
      .toBe('gaps: Sep 01, 2026, 12:30 UTC – Sep 02, 2026, 00:00 UTC')
  })

  it('never makes coverageNote throw on a bad time', () => {
    expect(coverageNote({ ...fullRange, gaps: [{ from: 'not a time', to: null }] })).toEqual(expect.any(String))
  })
})

describe('maskUncoveredBuckets', () => {
  const hours = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      point: `2026-09-01T${String(from + i).padStart(2, '0')}:00:00.000Z`,
      totalAmount: 0 as number | null,
    }))
  const amounts = (items: Array<{ totalAmount: number | null }>) => items.map((i) => i.totalAmount)

  it('leaves the old shape unchanged', () => {
    const items = hours(8, 10)
    expect(maskUncoveredBuckets(items, null, 'hour', 'totalAmount')).toBe(items)
  })

  it('nulls the buckets before covered_from, after covered_to and wholly inside merged gaps', () => {
    const range = {
      requested_from: '2026-09-01T08:00:00+00:00',
      requested_to: '2026-09-01T20:00:00+00:00',
      covered_from: '2026-09-01T10:30:00+00:00',
      covered_to: '2026-09-01T18:00:00+00:00',
      gaps: [
        { from: '2026-09-01T12:00:00+00:00', to: '2026-09-01T13:00:00+00:00' },
        { from: '2026-09-01T13:00:00+00:00', to: '2026-09-01T14:30:00+00:00' },
      ],
    }
    // 08 09 before; 10 holds covered_from; 12 13 inside the merged gap; 14 partly covered; 18 is the
    // inclusive end; 19 20 after
    expect(amounts(maskUncoveredBuckets(hours(8, 20), range, 'hour', 'totalAmount'))).toEqual([
      null, null, 0, 0, null, null, 0, 0, 0, 0, 0, null, null,
    ])
    // a half-open end leaves the bucket at covered_to out
    expect(amounts(maskUncoveredBuckets(hours(17, 18), { ...range, end_inclusive: false }, 'hour', 'totalAmount')))
      .toEqual([0, null])
  })

  it('masks a bucket left uncovered only by a gap and the end together', () => {
    const range = {
      ...partialRange,
      covered_from: '2026-09-01T00:00:00Z',
      covered_to: '2026-09-01T18:30:00Z',
      end_inclusive: false,
      gaps: [{ from: '2026-09-01T18:00:00Z', to: '2026-09-01T18:30:00Z' }],
    }
    expect(amounts(maskUncoveredBuckets(hours(17, 18), range, 'hour', 'totalAmount'))).toEqual([0, null])
  })

  it('reads open-ended gaps, masks everything when nothing is covered, and nothing for a bad bound', () => {
    const range = { ...partialRange, covered_from: '2026-09-01T00:00:00Z', covered_to: '2026-09-01T23:00:00Z' }
    expect(amounts(maskUncoveredBuckets(hours(8, 10), { ...range, gaps: [{ from: '2026-09-01T09:00:00Z', to: null }] }, 'hour', 'totalAmount')))
      .toEqual([0, null, null])
    expect(amounts(maskUncoveredBuckets(hours(8, 10), notCovered, 'hour', 'totalAmount'))).toEqual([null, null, null])
    expect(amounts(maskUncoveredBuckets(hours(8, 10), { ...range, covered_from: 'garbage' }, 'hour', 'totalAmount')))
      .toEqual([0, 0, 0])
  })

  it('masks whole days', () => {
    const days = ['2026-08-31', '2026-09-01', '2026-09-02'].map((d) => ({ point: `${d}T00:00:00.000Z`, totalAmount: 5 as number | null }))
    const range = { ...partialRange, covered_from: '2026-09-01T12:00:00Z', covered_to: '2026-09-02T08:00:00Z' }
    expect(amounts(maskUncoveredBuckets(days, range, 'day', 'totalAmount'))).toEqual([null, 5, 5])
  })
})
