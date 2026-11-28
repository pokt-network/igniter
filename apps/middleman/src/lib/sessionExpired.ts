// Shared by the middleware (edge runtime) and the browser, so it must stay free
// of node-only imports.
export const SESSION_EXPIRED_MESSAGE = 'Session expired'

// The middleware answers a server action without a session with a text/plain
// 401 whose body is this message, and Next's client rejects the action call with
// `new Error(body)`.
export function isSessionExpiredError(e: unknown): boolean {
  return e instanceof Error && e.message === SESSION_EXPIRED_MESSAGE
}

// Where every session-expiry sign-out lands; the landing page reads the query
// to offer signing in again.
export const SESSION_EXPIRED_REDIRECT = '/?session=expired'
