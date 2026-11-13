import { parseAprResponse } from './apr'

const raw = {
  windows: [
    {
      window_days: 7,
      network: { delegator_apr_pct_median: 19.6 },
      validators: [
        { operator_address: 'poktvaloper1a', delegator_apr_pct: 17.3, num_delegators: 126, full_window: true },
      ],
    },
    {
      window_days: 30,
      network: { delegator_apr_pct_median: 17.3 },
      validators: [
        { operator_address: 'poktvaloper1a', delegator_apr_pct: 18.1, num_delegators: 126, full_window: true },
        { operator_address: 'poktvaloper1b', delegator_apr_pct: 12.5, num_delegators: 3, full_window: false },
      ],
    },
  ],
}

describe('parseAprResponse', () => {
  it('indexes APR by operator address and window', () => {
    const out = parseAprResponse(raw)
    expect(out.byValidator['poktvaloper1a']![7]!.delegatorAprPct).toBe(17.3)
    expect(out.byValidator['poktvaloper1a']![30]!.delegatorAprPct).toBe(18.1)
    expect(out.byValidator['poktvaloper1b']![7]).toBeUndefined()
  })

  it('keeps the network median per window', () => {
    expect(parseAprResponse(raw).networkMedianPct).toEqual({ 7: 19.6, 30: 17.3 })
  })

  it('marks validators with partial history', () => {
    const out = parseAprResponse(raw)
    expect(out.byValidator['poktvaloper1b']![30]!.fullWindow).toBe(false)
    expect(out.byValidator['poktvaloper1a']![30]!.fullWindow).toBe(true)
  })

  it('ignores unknown windows and entries with no usable APR', () => {
    const out = parseAprResponse({
      windows: [
        { window_days: 14, validators: [{ operator_address: 'x', delegator_apr_pct: 1 }] },
        { window_days: 90, validators: [{ operator_address: 'y' }, { delegator_apr_pct: 5 }] },
      ],
    })
    expect(out.byValidator).toEqual({})
    expect(out.networkMedianPct).toEqual({})
  })

  it('returns empty structures for a malformed payload', () => {
    expect(parseAprResponse({})).toEqual({ byValidator: {}, networkMedianPct: {} })
    expect(parseAprResponse(null)).toEqual({ byValidator: {}, networkMedianPct: {} })
  })
})
