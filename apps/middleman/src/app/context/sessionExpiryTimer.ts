// setTimeout stores its delay as a signed 32-bit int; a longer one fires at once.
export const MAX_TIMEOUT_MS = 2 ** 31 - 1

/**
 * The session's end on the browser clock: the server sends the time left, not its own epoch,
 * because the two clocks may disagree. `receivedAt` is the browser's `Date.now()` on arrival.
 */
export function localDeadline(sessionRemainingMs: number, receivedAt: number): number {
  return receivedAt + sessionRemainingMs
}

/**
 * Milliseconds until `deadline`, clamped to what setTimeout accepts. 0 means
 * the deadline has passed and the sign-out is due now.
 */
export function expiryDelay(deadline: number, now: number): number {
  return Math.min(Math.max(deadline - now, 0), MAX_TIMEOUT_MS)
}
