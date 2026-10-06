import { coverageNote, unwrapRange } from './range'
import { mergeRewardRows, sumRewardTotals } from './rewards'

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
    expect(sumRewardTotals(['1000000', '2000000'])).toBe(3000000)
    expect(sumRewardTotals(['1000000', null])).toBe(1000000)
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
    expect(mergeRewardRows([[{ address: 'pokt1a', date_truncated: 'd', total_amount: '2' }], null])).toEqual([
      { address: 'pokt1a', date_truncated: 'd', total_amount: '2' },
    ])
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
    expect(coverageNote(mergeRewardRows([{ range: coveredNoRows, data: null }, { range: coveredNoRows, data: null }]).range)).toBeNull()
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
    expect(coverageNote({ ...fullRange, requested_to: '2026-09-02T00:00:00+00:00', gaps: [gap(13), gap(14), gap(15), gap(16), gap(17)] })).toBe(
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
