import { matureRewind, nextSettlement, REWIND_CONFIRM_MS, type PendingRewind } from './settlement'

// Mainnet settles about every 20 minutes (median gap between settlement heights over 30 days:
// 20.3 min, max 25 min, 2026-10-14), so the fallback waits three times that: it fires only when
// the indexer's money step is stuck, not on a healthy chain.
export const REWARDS_FALLBACK_MS = 60 * 60 * 1000

/**
 * When the rewards are fetched again, in one place (height.tsx holds it; Summary, the rewards
 * chart, ProviderBreakdown and useBlockRetry read its key). The rule: a higher settlement height
 * is a new epoch at once; a lower one (an indexer rewind) only once it has held for
 * REWIND_CONFIRM_MS (settlement.ts); with no new epoch for REWARDS_FALLBACK_MS, the fallback tick
 * is one, so a lagging money step never freezes the rewards.
 */
export type RewardsEpoch = {
  // the settlement height of getLastSettlement
  height: number
  pending: PendingRewind | null
  // fallback ticks so far
  tick: number
  // when the last epoch began (ms)
  since: number
}

export function initialRewardsEpoch(height: number, now: number): RewardsEpoch {
  return { height, pending: null, tick: 0, since: now }
}

/** The key the rewards are fetched for: it changes with each new epoch. */
export function rewardsEpochKey(epoch: RewardsEpoch): string {
  return `${epoch.height}/${epoch.tick}`
}

/** A status answer (its getLastSettlement height, at `now` ms). */
export function onSettlementAnswer(epoch: RewardsEpoch, answer: string | number | null | undefined, now: number): RewardsEpoch {
  const next = nextSettlement(epoch.height, answer, epoch.pending, now)
  if (next.height !== epoch.height) return { ...epoch, height: next.height, pending: null, since: now }
  if (samePending(next.pending, epoch.pending)) return epoch
  return { ...epoch, pending: next.pending }
}

/**
 * The clock at `now` ms: a pending rewind that has held long enough is a new epoch, else the
 * fallback tick once REWARDS_FALLBACK_MS passed. A hidden tab does not tick: `waitForShown` says the
 * tick is due, and height.tsx decides it once the tab is shown (fallbackTick).
 */
export function onClock(epoch: RewardsEpoch, now: number, hidden: boolean): { epoch: RewardsEpoch; waitForShown: boolean } {
  const matured = matureRewind(epoch.height, epoch.pending, now)
  if (matured.height !== epoch.height) return { epoch: { ...epoch, height: matured.height, pending: null, since: now }, waitForShown: false }
  if (now - epoch.since < REWARDS_FALLBACK_MS) return { epoch, waitForShown: false }
  return hidden ? { epoch, waitForShown: true } : { epoch: fallbackTick(epoch, now), waitForShown: false }
}

/** The fallback tick: a new epoch at the same settlement height. */
export function fallbackTick(epoch: RewardsEpoch, now: number): RewardsEpoch {
  return { ...epoch, tick: epoch.tick + 1, since: now }
}

/** When onClock may next change the epoch (ms). */
export function nextClockAt(epoch: RewardsEpoch): number {
  return Math.min(epoch.pending ? epoch.pending.since + REWIND_CONFIRM_MS : Infinity, epoch.since + REWARDS_FALLBACK_MS)
}

function samePending(a: PendingRewind | null, b: PendingRewind | null): boolean {
  return a === b || (a !== null && b !== null && a.height === b.height && a.since === b.since)
}
