import { assertSafeUrl, isOperatorTrustedHost } from '@igniter/notifications'

/**
 * Validation + change planning for the PROVIDERS governance sync.
 *
 * The CDN payload decides which providers the middleman lists and calls, so it is
 * treated as untrusted input:
 *  - every row is shape-checked (no zod dependency here, so by hand);
 *  - a row's url must be https to a public host (assertSafeUrl); plaintext http is
 *    accepted only for a host the operator allowlisted (NOTIFICATION_EGRESS_ALLOWLIST),
 *    which is how localnet reaches the in-cluster provider;
 *  - a rejected row that matches an existing provider is replaced by that provider's
 *    CURRENT values, so a malformed row neither rewrites nor disables it (the DAL
 *    disables every provider missing from the list);
 *  - the run is refused when it would change more than `maxChanges` providers
 *    (except the initial seed of an empty table), so a compromised source cannot
 *    rewrite or disable the whole list in one sweep.
 */

export type CdnProvider = { name: string; identity: string; identityHistory: string[]; url: string }
export type CurrentProvider = { identity: string; name: string; url: string; enabled: boolean; visible: boolean }

export const MAX_GOVERNANCE_ROWS = 1000
export const DEFAULT_MAX_CHANGES_PER_RUN = 20

const IDENTITY_RE = /^[A-Za-z0-9]{1,128}$/
const MAX_NAME_LEN = 200
const MAX_URL_LEN = 2048

export function maxChangesPerRun(raw = process.env.GOVERNANCE_MAX_CHANGES_PER_RUN): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CHANGES_PER_RUN
}

/** Shape check of one row; returns the reason it is invalid, or null. */
export function shapeError(row: unknown): string | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'not an object'
  const r = row as Record<string, unknown>
  if (typeof r.identity !== 'string' || !IDENTITY_RE.test(r.identity)) return 'invalid identity'
  if (typeof r.name !== 'string' || r.name.trim() === '' || r.name.length > MAX_NAME_LEN) return 'invalid name'
  if (typeof r.url !== 'string' || r.url.length > MAX_URL_LEN) return 'invalid url'
  if (!Array.isArray(r.identityHistory) || !r.identityHistory.every((h) => typeof h === 'string' && IDENTITY_RE.test(h))) {
    return 'invalid identityHistory'
  }
  return null
}

/** https + public host, or http to an operator-trusted host. Returns the reason, or null. */
export async function urlError(rawUrl: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'invalid url'
  }
  if (url.username || url.password) return 'url carries credentials'
  if (url.protocol === 'http:') {
    if (!(await isOperatorTrustedHost(url.hostname))) return 'url must be https'
  } else if (url.protocol !== 'https:') {
    return 'url must be https'
  }
  try {
    await assertSafeUrl(rawUrl)
  } catch (e) {
    return (e as Error).message
  }
  return null
}

export type Rejected = { index: number; identity?: string; reason: string }

export async function sanitizeProviders(
  payload: unknown,
  current: CurrentProvider[],
): Promise<{ providers: CdnProvider[]; rejected: Rejected[] }> {
  if (!Array.isArray(payload)) throw new Error('governance payload is not an array')
  if (payload.length > MAX_GOVERNANCE_ROWS) throw new Error(`governance payload has ${payload.length} rows (max ${MAX_GOVERNANCE_ROWS})`)

  const currentByIdentity = new Map(current.map((p) => [p.identity, p]))
  const providers: CdnProvider[] = []
  const rejected: Rejected[] = []
  const seen = new Set<string>()

  for (let index = 0; index < payload.length; index++) {
    const row = payload[index] as Record<string, unknown>
    const identity = typeof row?.identity === 'string' ? row.identity : undefined
    const reason = shapeError(row) ?? (await urlError(row.url as string))
    if (!reason && !seen.has(identity!)) {
      const p = row as unknown as CdnProvider
      providers.push({ name: p.name, identity: p.identity, identityHistory: [...p.identityHistory], url: p.url })
      seen.add(p.identity)
      continue
    }
    rejected.push({ index, identity, reason: reason ?? 'duplicate identity' })
    // Keep a known provider exactly as it is rather than letting the bad row disable it.
    const ids = [identity, ...(Array.isArray(row?.identityHistory) ? row.identityHistory : [])]
      .filter((x): x is string => typeof x === 'string')
    const existing = ids.map((id) => currentByIdentity.get(id)).find(Boolean)
    if (existing && !seen.has(existing.identity)) {
      providers.push({ name: existing.name, identity: existing.identity, identityHistory: [], url: existing.url })
      seen.add(existing.identity)
    }
  }
  return { providers, rejected }
}

export type PlannedChange =
  | { kind: 'add'; identity: string; name: string; url: string }
  | { kind: 'update'; fromIdentity: string; identity: string; fromName: string; name: string; fromUrl: string; url: string }
  | { kind: 'disable'; identity: string; name: string }

/** Mirrors dal.provider.upsertFromGovernance so the changes can be logged and capped before applying. */
export function planChanges(providers: CdnProvider[], current: CurrentProvider[]): PlannedChange[] {
  const currentMap = new Map(current.map((p) => [p.identity, p]))
  const all = new Set<string>()
  for (const p of providers) {
    all.add(p.identity)
    p.identityHistory.forEach((h) => all.add(h))
  }
  const changes: PlannedChange[] = []
  for (const p of providers) {
    const match = [p.identity, ...p.identityHistory].map((id) => currentMap.get(id)).find(Boolean)
    if (!match) {
      changes.push({ kind: 'add', identity: p.identity, name: p.name, url: p.url })
    } else if (match.identity !== p.identity || match.name !== p.name || match.url !== p.url) {
      changes.push({
        kind: 'update',
        fromIdentity: match.identity, identity: p.identity,
        fromName: match.name, name: p.name,
        fromUrl: match.url, url: p.url,
      })
    }
  }
  for (const c of current) {
    if (!all.has(c.identity) && (c.enabled || c.visible)) changes.push({ kind: 'disable', identity: c.identity, name: c.name })
  }
  return changes
}
