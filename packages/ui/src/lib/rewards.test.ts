import { mergeRewardBatches } from './rewards'

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
