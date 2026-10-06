/**
 * The indexer's legacy_ reward functions are moving from the bare value to
 * `{ range, data }`, where `range` says which part of the requested window the money tables
 * cover. Outside coverage the old shape raised an error; the new one answers with `data: null`
 * (nothing covered: no data, never 0) or with what is covered. Both shapes are read here, so
 * the site works before and after that indexer release.
 */
export interface CoverageGap {
  from: string
  to: string
}

export interface CoverageRange {
  requested_from: string | null
  requested_to: string | null
  covered_from: string | null
  covered_to: string | null
  gaps: Array<CoverageGap>
}

export interface Ranged<T> {
  data: T | null
  // null: the old shape, which says nothing about coverage
  range: CoverageRange | null
}

function isRanged(value: unknown): value is { range: CoverageRange; data: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'range' in value && 'data' in value
}

export function unwrapRange<T>(value: unknown): Ranged<T> {
  if (isRanged(value)) return { data: value.data as T | null, range: value.range }
  return { data: value as T | null, range: null }
}

// Every batch asks for the same window, so their ranges match; merged conservatively anyway.
function mergeRanges(ranges: Array<CoverageRange | null>): CoverageRange | null {
  const present = ranges.filter((r): r is CoverageRange => r != null)
  if (!present.length) return null
  const latest = (a: string | null, b: string | null) => (a == null || (b != null && new Date(b) > new Date(a)) ? b : a)
  const earliest = (a: string | null, b: string | null) => (a == null || (b != null && new Date(b) < new Date(a)) ? b : a)
  const gaps = new Map<string, CoverageGap>()
  for (const gap of present.flatMap((r) => r.gaps ?? [])) gaps.set(`${gap.from}|${gap.to}`, gap)
  return present.slice(1).reduce(
    (acc, r) => ({
      ...acc,
      covered_from: latest(acc.covered_from, r.covered_from),
      covered_to: earliest(acc.covered_to, r.covered_to),
    }),
    { ...present[0]!, gaps: Array.from(gaps.values()) },
  )
}

/**
 * Combines one field across supplier batches (see batch.ts). Old shape: `combine` over the bare
 * values, as before. New shape: `combine` over the batches with data, `data: null` when none
 * has any, and the ranges merged.
 */
export function combineBatches<T>(values: Array<unknown>, combine: (values: Array<unknown>) => T): T | Ranged<T> {
  if (!values.some(isRanged)) return combine(values)
  const parts = values.map((v) => unwrapRange<unknown>(v))
  const withData = parts.filter((p) => p.data != null).map((p) => p.data)
  return {
    data: withData.length ? combine(withData) : null,
    range: mergeRanges(parts.map((p) => p.range)),
  }
}

function formatUtc(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC'
}

/**
 * A short note when the data covers less than the requested window: "Data since <date>", plus
 * the gaps inside it. null for the old shape and for a fully covered window.
 */
export function coverageNote(range: CoverageRange | null): string | null {
  if (!range) return null
  const parts: Array<string> = []
  if (
    range.covered_from &&
    (range.requested_from == null || new Date(range.covered_from) > new Date(range.requested_from))
  ) {
    parts.push(`Data since ${formatUtc(range.covered_from)}`)
  }
  if (range.gaps?.length) {
    parts.push(`gaps: ${range.gaps.map((g) => `${formatUtc(g.from)} – ${formatUtc(g.to)}`).join(', ')}`)
  }
  return parts.length ? parts.join('; ') : null
}
