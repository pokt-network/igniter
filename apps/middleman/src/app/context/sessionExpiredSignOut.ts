import { signOut } from 'next-auth/react'
import { isSessionExpiredError, SESSION_EXPIRED_REDIRECT } from '@/lib/sessionExpired'

// Module state, so it is shared by every caller on the page: the expiry timer,
// the query caches and each call site that catches a rejected action. Only the
// first one signs out; the redirect reloads the page and resets it.
let signingOut = false

/** Starts the sign-out once per page load. Returns whether this call started it. */
export function signOutExpiredSession(): boolean {
  if (signingOut) return false
  signingOut = true
  signOut({ redirectTo: SESSION_EXPIRED_REDIRECT }).catch(() => window.location.assign(SESSION_EXPIRED_REDIRECT))
  return true
}

/**
 * For a catch around a server action: signs out and returns true when `err` is
 * the middleware's session-expired rejection, so the caller skips its own error
 * message; returns false for any other error.
 */
export function handleSessionExpired(err: unknown): boolean {
  if (!isSessionExpiredError(err)) return false
  signOutExpiredSession()
  return true
}
