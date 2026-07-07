const MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/**
 * Parse a duration string like `30s`, `3m`, `500ms` into milliseconds.
 * Returns `null` on ANY invalid input (never throws) — callers decide:
 * `bootstrap` throws on null; the watchdog warns + falls back to a default (D8).
 */
export function parseDuration(str: string): number | null {
  if (typeof str !== 'string') return null
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(str.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  return value * MULTIPLIERS[match[2]!]!
}
