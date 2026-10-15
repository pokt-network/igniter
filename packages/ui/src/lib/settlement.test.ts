import { matureRewind, nextSettlement, REWIND_CONFIRM_MS, shownTabTicks } from './settlement'

describe('nextSettlement', () => {
  it('changes nothing on an answer with no height: missing, empty, not a number, not positive', () => {
    const pending = { height: 90, since: 5 }
    for (const answer of [null, undefined, '', 'abc', Infinity, 0, '0', -3]) {
      expect(nextSettlement(100, answer, pending, 10)).toEqual({ height: 100, pending })
    }
  })

  it('takes a higher height at once and drops a pending rewind', () => {
    expect(nextSettlement(100, '120', null, 0)).toEqual({ height: 120, pending: null })
    expect(nextSettlement(100, 120, { height: 90, since: 5 }, 10)).toEqual({ height: 120, pending: null })
  })

  it('keeps the height on an equal answer, and drops a pending rewind', () => {
    expect(nextSettlement(100, '100', { height: 90, since: 5 }, 10)).toEqual({ height: 100, pending: null })
  })

  it('takes a lower height only once lower answers held for REWIND_CONFIRM_MS', () => {
    const first = nextSettlement(100, '90', null, 1000)
    expect(first).toEqual({ height: 100, pending: { height: 90, since: 1000 } })
    const soon = nextSettlement(first.height, '85', first.pending, 1000 + REWIND_CONFIRM_MS - 1)
    expect(soon).toEqual({ height: 100, pending: { height: 85, since: 1000 } })
    expect(nextSettlement(soon.height, '85', soon.pending, 1000 + REWIND_CONFIRM_MS)).toEqual({ height: 85, pending: null })
  })

  it('never takes a lower height that alternates with the current one (a lagging replica)', () => {
    let state = { height: 100, pending: null as { height: number; since: number } | null }
    for (let t = 0; t <= 4 * REWIND_CONFIRM_MS; t += 15_000) {
      state = nextSettlement(state.height, (t / 15_000) % 2 ? '100' : '90', state.pending, t)
    }
    expect(state.height).toBe(100)
  })
})

describe('matureRewind', () => {
  it('takes the pending rewind once it held for REWIND_CONFIRM_MS, with no new answer', () => {
    const pending = { height: 90, since: 1000 }
    expect(matureRewind(100, pending, 1000 + REWIND_CONFIRM_MS - 1)).toEqual({ height: 100, pending })
    expect(matureRewind(100, pending, 1000 + REWIND_CONFIRM_MS)).toEqual({ height: 90, pending: null })
  })

  it('changes nothing without a pending rewind', () => {
    expect(matureRewind(100, null, 10)).toEqual({ height: 100, pending: null })
  })
})

describe('shownTabTicks', () => {
  it('does not tick when the first answer brings a higher settlement height', () => {
    expect(shownTabTicks(100, 120)).toBe(false)
  })

  it('ticks when the first answer brings the same or a lower height', () => {
    expect(shownTabTicks(100, 100)).toBe(true)
    expect(shownTabTicks(100, 90)).toBe(true)
  })
})
