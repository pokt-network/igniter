// A lower settlement height must hold this long before it is taken as a rewind. Behind the API's
// load balancer a lagging replica can answer lower for a while, and taking each such answer would
// refetch the rewards on every flap; any equal or higher answer in between drops the pending rewind.
// A real rewind stays lower, and the rewards follow it this much later.
export const REWIND_CONFIRM_MS = 2 * 60 * 1000

// A rewind waiting to be confirmed: the latest lower height, and when lower answers started (ms)
export type PendingRewind = { height: number; since: number }

/** A status answer's settlement height, or null when it gives none: missing, '', not a positive number. */
function settlementHeightOf(answer: string | number | null | undefined): number | null {
  if (answer == null || answer === '') return null
  const height = Number(answer)
  return Number.isFinite(height) && height > 0 ? height : null
}

/**
 * The settlement height after a status answer (`answer`: its getLastSettlement height, at `now`
 * ms). A higher or equal height is taken at once and drops a pending rewind. A lower one (an
 * indexer rewind) becomes pending, and is taken once it has held for REWIND_CONFIRM_MS: on a later
 * answer, or by matureRewind on a timer, since Apollo drops answers equal to the last one. An answer
 * with no height changes nothing.
 */
export function nextSettlement(
  current: number,
  answer: string | number | null | undefined,
  pending: PendingRewind | null,
  now: number,
): { height: number; pending: PendingRewind | null } {
  const height = settlementHeightOf(answer)
  if (height === null) return { height: current, pending }
  if (height >= current) return { height, pending: null }
  return matureRewind(current, { height, since: pending?.since ?? now }, now)
}

/** The pending rewind taken once it has held for REWIND_CONFIRM_MS (height.tsx calls it on a timer too). */
export function matureRewind(
  current: number,
  pending: PendingRewind | null,
  now: number,
): { height: number; pending: PendingRewind | null } {
  if (pending && now - pending.since >= REWIND_CONFIRM_MS) return { height: pending.height, pending: null }
  return { height: current, pending }
}
