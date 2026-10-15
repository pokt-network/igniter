import { mergeRewardBatches, newerTotal } from './rewards'

describe('mergeRewardBatches', () => {
  it('sums the rows of different batches that share an (address, date)', () => {
    const batch1 = [
      { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: 100 },
      { address: 'pokt1a', date_truncated: '2026-10-02T00:00:00', total_amount: 50 },
      { address: 'pokt1b', date_truncated: '2026-10-01T00:00:00', total_amount: 7 },
    ]
    const batch2 = [
      { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: 30 },
      { address: 'pokt1b', date_truncated: '2026-10-02T00:00:00', total_amount: 9 },
    ]

    expect(mergeRewardBatches([...batch1, ...batch2])).toEqual([
      { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: 130 },
      { address: 'pokt1a', date_truncated: '2026-10-02T00:00:00', total_amount: 50 },
      { address: 'pokt1b', date_truncated: '2026-10-01T00:00:00', total_amount: 7 },
      { address: 'pokt1b', date_truncated: '2026-10-02T00:00:00', total_amount: 9 },
    ])
  })

  it('sums amounts that arrive as strings', () => {
    expect(mergeRewardBatches([
      { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: '100' },
      { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: '25' },
    ])).toEqual([
      { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: 125 },
    ])
  })

  it('does not mutate the input rows', () => {
    const row = { address: 'pokt1a', date_truncated: '2026-10-01T00:00:00', total_amount: 1 }
    mergeRewardBatches([row, { ...row }])
    expect(row.total_amount).toBe(1)
  })
})

describe('newerTotal', () => {
  const range = (requested_to: string) => ({
    requested_from: null, requested_to, covered_from: null, covered_to: requested_to, gaps: [],
  })
  const total = (data: number | null, end: string) => ({ data, range: range(end) })

  it('keeps the rewards on hand when the server has none (a failed fetch)', () => {
    const onHand = total(5, '2026-10-14T12:00:00Z')
    expect(newerTotal(onHand, null)).toBe(onHand)
    expect(newerTotal(onHand, { data: null, range: null })).toBe(onHand)
  })

  it('takes the server total when its window ends later', () => {
    const server = total(7, '2026-10-14T12:20:00Z')
    expect(newerTotal(total(5, '2026-10-14T12:00:00Z'), server)).toBe(server)
  })

  it('keeps the rewards on hand when the server window ends at the same time or earlier', () => {
    const onHand = total(5, '2026-10-14T12:00:00Z')
    expect(newerTotal(onHand, total(7, '2026-10-14T12:00:00Z'))).toBe(onHand)
    expect(newerTotal(onHand, total(7, '2026-10-14T11:00:00Z'))).toBe(onHand)
  })

  it('takes the server total when nothing is on hand', () => {
    const server = total(7, '2026-10-14T12:00:00Z')
    expect(newerTotal(null, server)).toBe(server)
  })
})
