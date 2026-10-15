import {
  clockUpdate,
  fallbackTick,
  initialRewardsEpoch,
  nextClockAt,
  onClock,
  onSettlementAnswer,
  REWARDS_FALLBACK_MS,
  rewardsEpochKey,
  shownUpdate,
} from './rewardsEpoch'
import { REWIND_CONFIRM_MS } from './settlement'

const MIN = 60 * 1000
const start = initialRewardsEpoch(100, 0)

describe('rewardsEpoch', () => {
  it('a higher settlement height is a new epoch at once', () => {
    const next = onSettlementAnswer(start, '120', 5 * MIN)
    expect(next.height).toBe(120)
    expect(rewardsEpochKey(next)).not.toBe(rewardsEpochKey(start))
  })

  it('the same height, or no answer, keeps the epoch', () => {
    expect(onSettlementAnswer(start, '100', MIN)).toBe(start)
    expect(onSettlementAnswer(start, null, MIN)).toBe(start)
  })

  it('a lower height is a new epoch only once it has held for 2 minutes', () => {
    const pending = onSettlementAnswer(start, '90', MIN)
    expect(rewardsEpochKey(pending)).toBe(rewardsEpochKey(start))
    expect(nextClockAt(pending)).toBe(MIN + REWIND_CONFIRM_MS)
    // Apollo drops equal answers, so the clock takes it, with no new answer
    expect(onClock(pending, MIN + REWIND_CONFIRM_MS - 1, false).epoch).toBe(pending)
    const rewound = onClock(pending, MIN + REWIND_CONFIRM_MS, false).epoch
    expect(rewound.height).toBe(90)
    expect(rewardsEpochKey(rewound)).not.toBe(rewardsEpochKey(start))
  })

  it('a lower answer followed by the same height again is no new epoch', () => {
    const back = onSettlementAnswer(onSettlementAnswer(start, '90', MIN), '100', 2 * MIN)
    expect(back.pending).toBeNull()
    expect(onClock(back, 2 * MIN + REWIND_CONFIRM_MS, false).epoch.height).toBe(100)
    expect(rewardsEpochKey(back)).toBe(rewardsEpochKey(start))
  })

  it('with no new epoch for 60 minutes, the fallback tick is one', () => {
    expect(nextClockAt(start)).toBe(REWARDS_FALLBACK_MS)
    expect(onClock(start, REWARDS_FALLBACK_MS - 1, false).epoch).toBe(start)
    const ticked = onClock(start, REWARDS_FALLBACK_MS, false).epoch
    expect(ticked.height).toBe(100)
    expect(rewardsEpochKey(ticked)).not.toBe(rewardsEpochKey(start))
    expect(nextClockAt(ticked)).toBe(2 * REWARDS_FALLBACK_MS)
  })

  it('a new settlement height restarts the 60 minutes', () => {
    const moved = onSettlementAnswer(start, '120', 50 * MIN)
    expect(onClock(moved, REWARDS_FALLBACK_MS, false).epoch).toBe(moved)
    expect(nextClockAt(moved)).toBe(50 * MIN + REWARDS_FALLBACK_MS)
  })

  it('a hidden tab does not tick: it waits to be shown', () => {
    expect(onClock(start, REWARDS_FALLBACK_MS, true)).toEqual({ epoch: start, waitForShown: true })
    expect(rewardsEpochKey(fallbackTick(start, REWARDS_FALLBACK_MS + MIN))).toBe('100/1')
  })

  it('the clock keeps an epoch queued in the same tick: a higher height is not lost', () => {
    // the timer was armed for `start` and finds the fallback due; a status answer with a higher height
    // was queued before it in the same tick
    const next = onClock(start, REWARDS_FALLBACK_MS, false).epoch
    const queued = onSettlementAnswer(start, '120', REWARDS_FALLBACK_MS)
    const applied = clockUpdate(start, next)(queued)
    expect(applied).toBe(queued)
    expect(applied.height).toBe(120)
  })

  it('the clock applies its epoch when nothing changed meanwhile, and a copy when nothing was due', () => {
    const next = onClock(start, REWARDS_FALLBACK_MS, false).epoch
    expect(clockUpdate(start, next)(start)).toBe(next)
    const copy = clockUpdate(start, start)(start)
    expect(copy).not.toBe(start)
    expect(copy).toEqual(start)
  })

  it('a shown tab: a higher answer is one new epoch, with no fallback tick on top', () => {
    const shown = shownUpdate('120', REWARDS_FALLBACK_MS + MIN)(start)
    expect(shown).toMatchObject({ height: 120, tick: 0 })
  })

  it('a shown tab: the same answer, or a failed poll, ticks the fallback once', () => {
    expect(shownUpdate('100', REWARDS_FALLBACK_MS + MIN)(start)).toMatchObject({ height: 100, tick: 1 })
    expect(shownUpdate(null, REWARDS_FALLBACK_MS + MIN)(start)).toMatchObject({ height: 100, tick: 1 })
  })

  it('a hidden tab takes no due rewind: the poll on show confirms it at once, keeping its start', () => {
    const pending = onSettlementAnswer(start, '90', MIN)
    const due = MIN + REWIND_CONFIRM_MS
    expect(onClock(pending, due, true)).toEqual({ epoch: pending, waitForShown: true })
    const shown = shownUpdate('90', due + 10 * MIN)(pending)
    expect(shown.height).toBe(90)
    expect(rewardsEpochKey(shown)).not.toBe(rewardsEpochKey(start))
  })

  it('a flap seen by a hidden tab (lower, then the same height on show) refetches nothing', () => {
    const pending = onSettlementAnswer(start, '90', MIN)
    expect(onClock(pending, MIN + REWIND_CONFIRM_MS, true).waitForShown).toBe(true)
    const shown = shownUpdate('100', MIN + REWIND_CONFIRM_MS + MIN)(pending)
    expect(shown).toMatchObject({ height: 100, pending: null, tick: 0 })
    expect(rewardsEpochKey(shown)).toBe(rewardsEpochKey(start))
  })
})
