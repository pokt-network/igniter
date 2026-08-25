/**
 * Shapes of the errors the database layer throws, and the questions a server
 * action needs to ask about them.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose message is
 * the statement plus its bound parameters:
 *
 *   Failed query: delete from "regions" where "regions"."id" = $1
 *   params: 1
 *
 * The driver's own error — the one carrying the SQLSTATE — is on `cause`. Two
 * consequences, both of which these helpers exist to handle: asking "was this a
 * constraint?" means walking the chain, not reading `message`; and forwarding
 * `message` to a browser ships the schema and the parameter values with it.
 */

/** Postgres SQLSTATE 23503 — the row is still referenced by another table. */
const FOREIGN_KEY_VIOLATION = '23503'

/** Depth cap: drivers nest one level, but never trust a chain not to cycle. */
const MAX_CAUSE_DEPTH = 5

function hasSqlState(error: unknown, sqlState: string): boolean {
  let current: unknown = error

  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if ((current as { code?: unknown }).code === sqlState) return true
    current = (current as { cause?: unknown }).cause
  }

  return false
}

/**
 * True when a write was refused because the row is still referenced elsewhere
 * (a RESTRICT / NO ACTION foreign key). Nothing was written: the caller can say
 * so in its own words instead of surfacing the constraint name.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasSqlState(error, FOREIGN_KEY_VIOLATION)
}

/**
 * True when any link in the chain looks like an error `pg` raised: the server
 * stamps `severity`/`routine` on what it sends back, and a failed socket carries
 * `syscall`/`errno`. Checked separately from the drizzle wrapper because drizzle
 * wraps only the query itself — acquiring a pool connection and mapping the
 * result both sit outside it, and those errors name the host, the user, or the
 * database in their message.
 */
function hasPgShape(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    const candidate = current as {
      severity?: unknown
      routine?: unknown
      syscall?: unknown
      errno?: unknown
    }
    // `severity` and `routine` are pg's own and unambiguous.
    if (typeof candidate.severity === 'string' || typeof candidate.routine === 'string') return true
    // A bare socket failure is NOT unambiguous: any library that connects
    // somewhere produces this shape. It is accepted because a pool that cannot
    // reach Postgres has nothing else to identify it by, and its message names
    // the host and port. The safety of that trade depends on such errors not
    // reaching a boundary with a socket error on their `cause` chain:
    //   - `fetch` failures are excluded by the TypeError check in isDatabaseError
    //   - nodemailer preserves `syscall` (ESOCKET), and `ChannelDeliveryError`
    //     currently drops the original rather than passing it as `cause`
    //   - ApolloError DOES set `cause`, and its two call sites happen to sit
    //     outside the action wrappers
    // Adding `{ cause }` to ChannelDeliveryError, or wrapping those Apollo call
    // sites, would make channel-test and indexer failures report themselves as
    // database errors. If that becomes necessary, require corroboration here —
    // an SQLSTATE-shaped `code` — rather than deleting the clause.
    if (typeof candidate.syscall === 'string' && candidate.errno !== undefined) return true
    current = (current as { cause?: unknown }).cause
  }

  return false
}

/**
 * True when the error came from the database rather than application code — its
 * message is a SQL statement and its parameters, or a connection detail — and
 * must not cross the wire to a client.
 */
export function isDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (typeof (error as { query?: unknown }).query === 'string') return true
  if (error.message.startsWith('Failed query:')) return true
  // Node reports a failed `fetch` as TypeError('fetch failed') with the socket
  // error on `cause` — by shape indistinguishable from a pool that could not
  // connect. Those are outbound HTTP calls (the governance CDN, a webhook), not
  // the database, and their message belongs to whoever made the call, so the
  // shape check stops here rather than relabelling them.
  if (error instanceof TypeError) return false
  return hasPgShape(error)
}

/**
 * What a client may be told about a database failure, or null when the error did
 * not come from the database and the caller's own message is safe to forward.
 *
 * One definition rather than three: every boundary that answers a browser — both
 * apps' action wrappers and middleman's notification actions — needs the same
 * answer, and a boundary that drifts is how the statement text escaped before.
 */
export function describeDatabaseFailure(
  error: unknown,
): { code: 'CONSTRAINT_VIOLATION' | 'INTERNAL_ERROR'; message: string } | null {
  if (isForeignKeyViolation(error)) {
    return {
      code: 'CONSTRAINT_VIOLATION',
      message: 'This record is still referenced by other records.',
    }
  }

  if (isDatabaseError(error)) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'A database error occurred. Please try again or contact support if the problem persists.',
    }
  }

  return null
}
