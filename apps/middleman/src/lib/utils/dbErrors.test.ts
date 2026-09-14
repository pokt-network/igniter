import { describeDatabaseFailure, isDatabaseError, isForeignKeyViolation } from '@igniter/db/errors'

// Shapes copied from what the runtime actually throws, so the heuristics in
// `@igniter/db/errors` are pinned to the real inputs rather than to each other.

/** drizzle 0.44 `DrizzleQueryError`: statement + params in the message, driver error on `cause`. */
function drizzleQueryError(cause?: unknown): Error {
  const err = new Error(
    'Failed query: delete from "regions" where "regions"."id" = $1\nparams: 1',
  )
  ;(err as { query?: string }).query = 'delete from "regions" where "regions"."id" = $1'
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause
  return err
}

/** What `pg` raises for a server-side error: SQLSTATE in `code`, plus `severity`/`routine`. */
function pgServerError(code: string): Error {
  return Object.assign(new Error('update or delete on table "regions" violates foreign key constraint'), {
    code,
    severity: 'ERROR',
    routine: 'ri_ReportViolation',
  })
}

/** What `pg` raises when the pool cannot reach the server. */
function pgSocketError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
    code: 'ECONNREFUSED',
    errno: -111,
    syscall: 'connect',
  })
}

/** Wraps `inner` under `levels` plain Errors, each pointing at the next via `cause`. */
function nest(inner: Error, levels: number): Error {
  let current = inner
  for (let i = 0; i < levels; i += 1) {
    const outer = new Error(`wrapper ${i}`)
    ;(outer as { cause?: unknown }).cause = current
    current = outer
  }
  return current
}

/** Node's `fetch` failure: a TypeError whose `cause` is the same socket shape as above. */
function fetchFailed(): Error {
  const err = new TypeError('fetch failed')
  ;(err as { cause?: unknown }).cause = pgSocketError()
  return err
}

describe('isForeignKeyViolation', () => {
  it('finds SQLSTATE 23503 on the driver error nested under the drizzle wrapper', () => {
    expect(isForeignKeyViolation(drizzleQueryError(pgServerError('23503')))).toBe(true)
  })

  it('finds it on a bare driver error too', () => {
    expect(isForeignKeyViolation(pgServerError('23503'))).toBe(true)
  })

  it('is false for any other SQLSTATE', () => {
    expect(isForeignKeyViolation(drizzleQueryError(pgServerError('23505')))).toBe(false)
  })

  it('is false for non-database errors and non-errors', () => {
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false)
    expect(isForeignKeyViolation(undefined)).toBe(false)
    expect(isForeignKeyViolation('23503')).toBe(false)
  })

  it('terminates on a cyclic cause chain (via the depth cap)', () => {
    const err = new Error('loop') as Error & { cause?: unknown }
    err.cause = err
    expect(isForeignKeyViolation(err)).toBe(false)
  })

  it('gives up past the cause-depth cap', () => {
    // Root at depth 0, driver error at depth 4: within the cap of 5.
    expect(isForeignKeyViolation(nest(pgServerError('23503'), 4))).toBe(true)
    // At depth 5 it is one link too far.
    expect(isForeignKeyViolation(nest(pgServerError('23503'), 5))).toBe(false)
  })
})

describe('isDatabaseError', () => {
  it('recognises the drizzle wrapper by its message', () => {
    expect(isDatabaseError(drizzleQueryError())).toBe(true)
  })

  it('recognises a pg server error by severity/routine', () => {
    expect(isDatabaseError(pgServerError('42P01'))).toBe(true)
  })

  it('accepts either pg marker on its own', () => {
    expect(isDatabaseError(Object.assign(new Error('x'), { severity: 'ERROR' }))).toBe(true)
    expect(isDatabaseError(Object.assign(new Error('x'), { routine: 'exec_simple_query' }))).toBe(true)
  })

  // Documented hazard in errors.ts: a socket error on the cause chain of any
  // non-TypeError IS taken as the database. Pinned so that adding `{ cause }`
  // to ChannelDeliveryError, or wrapping an Apollo call, fails a test rather
  // than silently relabelling a channel-test or indexer outage.
  it('treats a non-fetch wrapper around a socket error as the database (known trade-off)', () => {
    expect(isDatabaseError(nest(pgSocketError(), 1))).toBe(true)
  })

  it('recognises a pool connection failure by syscall/errno', () => {
    expect(isDatabaseError(pgSocketError())).toBe(true)
  })

  // The socket clause needs BOTH markers: either alone is too common a shape.
  it('does not accept syscall or errno on their own, nor a bare ECONNREFUSED code', () => {
    expect(isDatabaseError(Object.assign(new Error('x'), { syscall: 'connect' }))).toBe(false)
    expect(isDatabaseError(Object.assign(new Error('x'), { errno: -111 }))).toBe(false)
    expect(isDatabaseError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false)
  })

  it('recognises the drizzle wrapper by its `query` property alone', () => {
    const err = new Error('some other message')
    ;(err as { query?: string }).query = 'select 1'
    expect(isDatabaseError(err)).toBe(true)
  })

  it('walks the cause chain to find the pg shape', () => {
    const wrapped = new Error('could not acquire connection')
    ;(wrapped as { cause?: unknown }).cause = pgSocketError()
    expect(isDatabaseError(wrapped)).toBe(true)
  })

  // Regression: a governance-CDN outage once reported "A database error
  // occurred" because `fetch failed` carries the same socket shape on `cause`.
  it('does NOT treat a failed fetch as a database error', () => {
    expect(isDatabaseError(fetchFailed())).toBe(false)
  })

  it('is false for application errors and non-errors', () => {
    expect(isDatabaseError(new Error('Unauthorized'))).toBe(false)
    expect(isDatabaseError({ message: 'Failed query: not an Error instance' })).toBe(false)
    expect(isDatabaseError(null)).toBe(false)
  })
})

describe('describeDatabaseFailure', () => {
  it('maps a foreign key refusal to CONSTRAINT_VIOLATION with a client-safe message', () => {
    const result = describeDatabaseFailure(drizzleQueryError(pgServerError('23503')))
    expect(result).toEqual({
      code: 'CONSTRAINT_VIOLATION',
      message: 'This record is still referenced by other records.',
    })
  })

  it('maps any other database error to INTERNAL_ERROR without leaking the statement', () => {
    const result = describeDatabaseFailure(drizzleQueryError(pgServerError('42P01')))
    expect(result).not.toBeNull()
    expect(result?.code).toBe('INTERNAL_ERROR')
    expect(result?.message).not.toContain('Failed query')
    expect(result?.message).not.toContain('params')
    expect(result?.message).not.toContain('regions')
  })

  it('maps a pool connection failure to INTERNAL_ERROR without the host and port', () => {
    const result = describeDatabaseFailure(pgSocketError())
    expect(result).not.toBeNull()
    expect(result?.code).toBe('INTERNAL_ERROR')
    expect(result?.message).not.toContain('5432')
  })

  it('returns null for errors the caller may forward as-is', () => {
    expect(describeDatabaseFailure(new Error('Provider is disabled'))).toBeNull()
    expect(describeDatabaseFailure(fetchFailed())).toBeNull()
    expect(describeDatabaseFailure(undefined)).toBeNull()
  })
})
