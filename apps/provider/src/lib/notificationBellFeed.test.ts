import { bellSeverity, eventDetail, eventTitle } from './notificationBellFeed'
import { NOTIFICATION_EVENT_LABELS } from './constants'

// Metadata shapes are unions on the schema type; the helpers only branch on the
// discriminating key, so the casts keep the fixtures readable.
const detailOf = (type: string, metadata: unknown) =>
  eventDetail({ type, metadata } as Parameters<typeof eventDetail>[0])

const titleOf = (type: string) => eventTitle({ type } as Parameters<typeof eventTitle>[0])

describe('bellSeverity', () => {
  it('maps each known event type to its history-table severity', () => {
    expect(bellSeverity('keys_staked')).toBe('success')
    expect(bellSeverity('keys_unstaked')).toBe('warning')
    expect(bellSeverity('supplier_funds_low')).toBe('warning')
    expect(bellSeverity('supplier_stake_low')).toBe('error')
    expect(bellSeverity('remediation_summary')).toBe('info')
    expect(bellSeverity('delegators_synced')).toBe('info')
  })

  it('falls back to info for an unknown type', () => {
    expect(bellSeverity('not_a_real_event')).toBe('info')
  })
})

describe('eventTitle', () => {
  it('uses the shared label map', () => {
    expect(titleOf('keys_staked')).toBe(NOTIFICATION_EVENT_LABELS.keys_staked)
  })

  it('falls back to the raw type when unmapped', () => {
    expect(titleOf('not_a_real_event')).toBe('not_a_real_event')
  })
})

describe('eventDetail — address-list events', () => {
  it('phrases each supplier-list type in its own voice', () => {
    const meta = { addresses: ['pokt1a', 'pokt1b'] }
    expect(detailOf('keys_staked', meta)).toBe('2 suppliers finished staking')
    expect(detailOf('keys_unstaked', meta)).toBe('2 suppliers started unstaking')
    expect(detailOf('supplier_funds_low', meta)).toBe('2 suppliers low on operational funds')
    expect(detailOf('supplier_stake_low', meta)).toBe('2 suppliers below the minimum stake')
  })

  it('singularises a one-address list', () => {
    expect(detailOf('keys_staked', { addresses: ['pokt1a'] })).toBe('1 supplier finished staking')
  })

  it('falls back to the neutral noun for an unmapped type', () => {
    expect(detailOf('some_other_event', { addresses: ['pokt1a', 'pokt1b'] })).toBe('2 suppliers')
  })
})

describe('eventDetail — remediation summaries', () => {
  const reasons = (byReason: Record<string, { succeeded: string[]; failed: string[] }>) =>
    detailOf('remediation_summary', { byReason })

  it('names what was fixed when everything succeeded', () => {
    expect(reasons({ '1001': { succeeded: ['pokt1a'], failed: [] } })).toBe('service config fixed')
  })

  it('joins distinct reason phrases and de-duplicates repeats', () => {
    expect(
      reasons({
        '1001': { succeeded: ['pokt1a'], failed: [] },
        '1004': { succeeded: ['pokt1b'], failed: [] },
      }),
    ).toBe('service config fixed, stake topped up')
  })

  it('falls back to counts when anything failed, so failures are not hidden', () => {
    expect(
      reasons({
        '1001': { succeeded: ['pokt1a'], failed: ['pokt1b'] },
        '1005': { succeeded: [], failed: ['pokt1c'] },
      }),
    ).toBe('1 succeeded, 2 failed')
  })

  it('ignores reasons with no attempts at all', () => {
    expect(
      reasons({
        '1001': { succeeded: ['pokt1a'], failed: [] },
        '1006': { succeeded: [], failed: [] },
      }),
    ).toBe('service config fixed')
  })

  it('uses a generic phrase for an unmapped reason code', () => {
    expect(reasons({ '9999': { succeeded: ['pokt1a'], failed: [] } })).toBe('remediated')
  })

  it('reports zero counts for a summary with nothing in it', () => {
    // No successes to name, so it takes the counts branch rather than going blank.
    expect(reasons({})).toBe('0 succeeded, 0 failed')
  })
})

describe('eventDetail — delegator sync', () => {
  it('sums the three change buckets', () => {
    expect(detailOf('delegators_synced', { inserted: 1, updated: 2, disabled: 3 })).toBe('6 changes')
  })

  it('singularises a single change', () => {
    expect(detailOf('delegators_synced', { inserted: 1, updated: 0, disabled: 0 })).toBe('1 change')
  })

  it('reports zero changes rather than an empty card', () => {
    expect(detailOf('delegators_synced', { inserted: 0, updated: 0, disabled: 0 })).toBe('0 changes')
  })
})

describe('eventDetail — no usable metadata', () => {
  it('returns empty so the card renders title-only', () => {
    expect(detailOf('keys_staked', null)).toBe('')
    expect(detailOf('keys_staked', {})).toBe('')
  })
})
