/**
 * The governance source of providers (PROVIDERS_CDN_URL): the only list of providers the
 * middleman may call. A provider row in the database is not enough, because rows can be written
 * by other paths; every outbound provider call resolves its url here instead.
 */

import { lookup } from 'node:dns/promises'

export type GovernanceProvider = { identity: string; url: string }

/** The source could not be read and there is no earlier copy to fall back to. */
export class GovernanceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GovernanceUnavailableError'
  }
}

/** The source url for a chain, as the governance syncs build it. */
export function governanceSourceUrl(template: string, chainId: string): string {
  return template.replace('{chainId}', chainId.replace('lego-testnet', 'beta'))
}

export const GOVERNANCE_TTL_MS = 10 * 60 * 1000
// After a failed refresh with a copy in hand, wait this long before trying the source again.
const RETRY_AFTER_FAILURE_MS = 30 * 1000
const FETCH_TIMEOUT_MS = 10 * 1000

export interface GovernanceRegistryOptions {
  /** Builds the source url; throwing (e.g. env var missing) counts as the source being unavailable. */
  getSourceUrl: () => Promise<string> | string
  ttlMs?: number
  fetchFn?: typeof fetch
  now?: () => number
  /**
   * Whether every entry must carry a url (the providers source does; the delegators source lists
   * identities only). Default true. With false, an entry without a url resolves with `url: ''`.
   */
  requireUrl?: boolean
  /**
   * Checks an entry's url; returns the reason it is refused, or null. When given, an entry whose
   * url is refused (or whose check throws) is left out of the registry, so it resolves to null as if
   * the source did not list it; the rest of the source is kept. A check that throws
   * TransientUrlCheckError (see assertDnsAvailable), or times out, fails the whole refresh instead:
   * the last-good copy keeps being served (cold cache: GovernanceUnavailableError). Entries with an
   * empty url (identity-only sources) are not checked. The verdict is cached with the copy, until
   * the next refresh.
   */
  validateUrl?: (url: string) => Promise<string | null>
  /** Per-entry bound on `validateUrl`; a slower check counts as transient. Default 10 s. */
  urlCheckTimeoutMs?: number
}

export interface GovernanceRegistry {
  /**
   * The governance entry for the provider's CURRENT identity (identityHistory is not matched),
   * or null when the source does not list it. Throws GovernanceUnavailableError when the source
   * cannot be read and no earlier copy exists (fail closed).
   */
  resolve(identity: string): Promise<GovernanceProvider | null>
}

function parseSource(body: unknown, requireUrl: boolean): Map<string, GovernanceProvider> {
  if (!Array.isArray(body)) {
    throw new Error('governance source is not a list')
  }
  const byIdentity = new Map<string, GovernanceProvider>()
  for (const entry of body) {
    const { identity, url } = (entry ?? {}) as { identity?: unknown; url?: unknown }
    if (typeof identity !== 'string' || !identity) {
      throw new Error('governance source has an entry without identity')
    }
    if (requireUrl ? typeof url !== 'string' || !url : url !== undefined && typeof url !== 'string') {
      throw new Error('governance source has an entry without a valid url')
    }
    byIdentity.set(identity, { identity, url: (url as string | undefined) ?? '' })
  }
  return byIdentity
}

/**
 * A url check that could not reach a verdict (DNS timeout or server failure). Unlike a policy
 * refusal it says nothing about the entry, so the whole refresh fails and the last-good copy stays.
 */
export class TransientUrlCheckError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TransientUrlCheckError'
  }
}

export const URL_CHECK_TIMEOUT_MS = 10 * 1000

// Resolver answers that mean "ask again later", not "this name does not exist".
const TRANSIENT_DNS_CODES = new Set(['EAI_AGAIN', 'ETIMEOUT', 'ETIMEDOUT', 'ESERVFAIL', 'ECONNREFUSED', 'ECANCELLED'])

/**
 * Resolves the host once and throws TransientUrlCheckError when the resolver itself failed. A name
 * that does not exist (ENOTFOUND) is left to the policy check, which refuses that entry only.
 */
export async function assertDnsAvailable(
  hostname: string,
  lookupFn: (host: string) => Promise<unknown> = (host) => lookup(host, { all: true }),
): Promise<void> {
  try {
    await lookupFn(hostname.replace(/^\[|\]$/g, ''))
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code && TRANSIENT_DNS_CODES.has(code)) {
      throw new TransientUrlCheckError(`DNS lookup for ${hostname} failed (${code})`, { cause: error })
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TransientUrlCheckError(`url check timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Drops the entries whose url `validateUrl` refuses (a returned reason, or a throw). A transient
 * failure of ANY check (TransientUrlCheckError, or a check slower than URL_CHECK_TIMEOUT_MS) fails
 * the whole refresh instead, so a DNS blip never makes a listed provider look unlisted.
 */
async function excludeRefusedUrls(
  byIdentity: Map<string, GovernanceProvider>,
  validateUrl: (url: string) => Promise<string | null>,
  timeoutMs: number,
): Promise<Map<string, GovernanceProvider>> {
  const verdicts = await Promise.all(
    [...byIdentity.values()].map(async (entry) => {
      if (!entry.url) return { entry, refused: false }
      try {
        return { entry, refused: (await withTimeout(validateUrl(entry.url), timeoutMs)) !== null }
      } catch (error) {
        if (error instanceof TransientUrlCheckError) throw error
        return { entry, refused: true }
      }
    }),
  )
  for (const { entry, refused } of verdicts) {
    if (refused) byIdentity.delete(entry.identity)
  }
  return byIdentity
}

/**
 * A last-good cache of the governance source. A copy younger than the TTL is used as is; an older
 * one is refreshed, and kept (served) when the refresh fails.
 */
export function createGovernanceRegistry(options: GovernanceRegistryOptions): GovernanceRegistry {
  const ttlMs = options.ttlMs ?? GOVERNANCE_TTL_MS
  const fetchFn = options.fetchFn ?? fetch
  const now = options.now ?? Date.now
  const requireUrl = options.requireUrl ?? true

  let cache: { byIdentity: Map<string, GovernanceProvider>; fetchedAt: number } | null = null
  let nextAttemptAt = 0
  let inFlight: Promise<Map<string, GovernanceProvider>> | null = null

  async function fetchSource(): Promise<Map<string, GovernanceProvider>> {
    const url = await options.getSourceUrl()
    const response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) {
      throw new Error(`governance source answered HTTP ${response.status}`)
    }
    const byIdentity = parseSource(await response.json(), requireUrl)
    return options.validateUrl
      ? excludeRefusedUrls(byIdentity, options.validateUrl, options.urlCheckTimeoutMs ?? URL_CHECK_TIMEOUT_MS)
      : byIdentity
  }

  async function load(): Promise<Map<string, GovernanceProvider>> {
    const at = now()
    if (cache && (at - cache.fetchedAt < ttlMs || at < nextAttemptAt)) {
      return cache.byIdentity
    }

    if (!inFlight) {
      inFlight = fetchSource()
        .then((byIdentity) => {
          cache = { byIdentity, fetchedAt: now() }
          return byIdentity
        })
        .finally(() => {
          inFlight = null
        })
    }

    try {
      return await inFlight
    } catch (error) {
      if (cache) {
        nextAttemptAt = now() + RETRY_AFTER_FAILURE_MS
        return cache.byIdentity
      }
      throw new GovernanceUnavailableError('The governance source of providers is unavailable', { cause: error })
    }
  }

  return {
    async resolve(identity: string) {
      const byIdentity = await load()
      return byIdentity.get(identity) ?? null
    },
  }
}
