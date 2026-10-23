/**
 * What a release POST to a provider ended in, as far as the middleman can tell.
 *
 * - `ok`: the provider answered 2xx.
 * - `not-sent`: the request provably never reached the provider (no connection, no DNS answer,
 *   TLS refused before any byte of the body), so sending it again cannot double-release.
 * - `ambiguous`: anything else. The provider may have committed the release even though we got no
 *   good answer (its own 500 can follow a committed UPDATE, a socket can drop after it, a timeout
 *   can fire after it), so the caller must not send it again.
 */
export type ReleaseOutcome =
  | { kind: 'ok' }
  | { kind: 'not-sent'; code: string }
  | { kind: 'ambiguous'; status?: number; code?: string; message: string }

/**
 * Error codes that prove the request was never sent. Exact match only, never a prefix: `EPROTO`
 * and `ERR_SSL_*` can be raised after the request went out and stay ambiguous. Do not add timeouts
 * or socket errors here.
 */
export const RELEASE_NOT_SENT_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/**
 * `not-sent` code for a failure before `fetch` was invoked (settings, signing). A code-path proof,
 * not a network code: it is deliberately not part of RELEASE_NOT_SENT_CODES.
 */
export const RELEASE_LOCAL_PRE_SEND = 'LOCAL_PRE_SEND'

const MAX_CAUSE_DEPTH = 10

/**
 * First string `code` on the error or its `cause` chain. undici's fetch rejects with
 * `TypeError('fetch failed')` and puts the system error (with its `code`) in `cause`. Numeric
 * codes (DOMException's legacy `code`, e.g. 23 for a TimeoutError) are skipped.
 */
function findErrorCode(err: unknown): string | undefined {
  let current: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === 'object'; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown }
    if (typeof code === 'string' && code.length > 0) return code
    if (cause === current) break
    current = cause
  }
  return undefined
}

/** Classifies an error thrown while sending a release POST. Never returns `ok`. */
export function classifyReleaseError(err: unknown): ReleaseOutcome {
  const code = findErrorCode(err)
  if (code && RELEASE_NOT_SENT_CODES.has(code)) {
    return { kind: 'not-sent', code }
  }

  const message = err instanceof Error
    ? `${err.name}: ${err.message}`
    : String(err)

  return code ? { kind: 'ambiguous', code, message } : { kind: 'ambiguous', message }
}

/** Classifies an HTTP answer to a release POST: 2xx is `ok`, every other status is ambiguous. */
export function classifyReleaseResponse(status: number, statusText: string): ReleaseOutcome {
  if (status >= 200 && status < 300) return { kind: 'ok' }
  return { kind: 'ambiguous', status, message: `HTTP ${status}${statusText ? ` ${statusText}` : ''}` }
}
