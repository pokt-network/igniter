/**
 * The indexer's legacy_ reward functions are moving from the bare value to
 * `{ range, data }`, where `range` says which part of the requested window the money tables
 * cover. Outside coverage the old shape raised an error; the new one answers with what is
 * covered. "Nothing covered" is said only by covered_from / covered_to null, never by data alone:
 * the series functions also answer data null for a covered window with no rows. Both shapes are
 * read here, so the site works before and after that indexer release.
 */
// Half-open [from, to); a null edge is open-ended
export interface CoverageGap {
  from: string | null
  to: string | null
}

export interface CoverageRange {
  requested_from: string | null
  requested_to: string | null
  // both null when nothing in the requested window is covered
  covered_from: string | null
  covered_to: string | null
  gaps: Array<CoverageGap>
  // true for the legacy_ functions (their end is inclusive), false for the catalog ones; only the
  // note reads the range, and at its minute resolution an inclusive end changes nothing
  end_inclusive?: boolean
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

/** Nothing in the requested window is covered: said only by null covered bounds, never by data. */
export function isUncovered(range: CoverageRange | null): boolean {
  return range != null && range.covered_from == null && range.covered_to == null
}

// Postgres prints timestamptz with 0 to 6 fractional digits; ECMAScript only specifies exactly 3
export function parseTime(time: string): Date {
  return new Date(time.replace(/\.(\d+)/, (_, fraction: string) => '.' + fraction.padEnd(3, '0').slice(0, 3)))
}

// Every batch asks for the same window, so their ranges match; merged conservatively anyway.
export function mergeRanges(ranges: Array<CoverageRange | null>): CoverageRange | null {
  const present = ranges.filter((r): r is CoverageRange => r != null)
  if (!present.length) return null
  const latest = (a: string | null, b: string | null) => (a == null || (b != null && parseTime(b) > parseTime(a)) ? b : a)
  const earliest = (a: string | null, b: string | null) => (a == null || (b != null && parseTime(b) < parseTime(a)) ? b : a)
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
 * Combines one field across supplier batches (see batch.ts), in either shape, into one Ranged:
 * `combine` over the batches with data, `data: null` when none has any, and the ranges merged
 * (`range: null` for the old shape).
 */
export function combineBatches<T>(values: Array<unknown>, combine: (values: Array<unknown>) => T): Ranged<T> {
  const parts = values.map((v) => unwrapRange<unknown>(v))
  const withData = parts.filter((p) => p.data != null).map((p) => p.data)
  return {
    data: withData.length ? combine(withData) : null,
    range: mergeRanges(parts.map((p) => p.range)),
  }
}

function formatUtc(date: string | null): string {
  if (date == null) return '…'
  const time = parseTime(date)
  if (Number.isNaN(time.getTime())) return date
  return time.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // not hour12: false, which some engines print as 24:00 at midnight
    hourCycle: 'h23',
    timeZone: 'UTC',
  }) + ' UTC'
}

// Clips a gap to the covered part of the window (what lies before it is already said by "Data
// since"); null when nothing of it is left.
function clipGap(gap: CoverageGap, range: CoverageRange): CoverageGap | null {
  const start = range.covered_from ?? range.requested_from
  const end = range.covered_to ?? range.requested_to
  const from = gap.from == null || (start != null && parseTime(start) > parseTime(gap.from)) ? start : gap.from
  const to = gap.to == null || (end != null && parseTime(end) < parseTime(gap.to)) ? end : gap.to
  if (from != null && to != null && parseTime(from) >= parseTime(to)) return null
  return { from, to }
}

export const NO_COVERAGE_NOTE = 'No indexed data for this range'
const MAX_LISTED_GAPS = 3

/**
 * A short note when the data covers less than the requested window: "Data since <date>", plus
 * the gaps inside it, or NO_COVERAGE_NOTE when nothing is covered. null for the old shape and
 * for a fully covered window.
 */
export function coverageNote(range: CoverageRange | null): string | null {
  if (!range) return null
  if (isUncovered(range)) return NO_COVERAGE_NOTE
  const parts: Array<string> = []
  if (
    range.covered_from &&
    (range.requested_from == null || parseTime(range.covered_from) > parseTime(range.requested_from))
  ) {
    parts.push(`Data since ${formatUtc(range.covered_from)}`)
  }
  const gaps = (range.gaps ?? []).map((g) => clipGap(g, range)).filter((g): g is CoverageGap => g != null)
  if (gaps.length) {
    const listed = gaps.slice(0, MAX_LISTED_GAPS).map((g) => `${formatUtc(g.from)} – ${formatUtc(g.to)}`)
    if (gaps.length > MAX_LISTED_GAPS) listed.push(`${gaps.length - MAX_LISTED_GAPS} more`)
    parts.push(`gaps: ${listed.join(', ')}`)
  }
  return parts.length ? parts.join('; ') : null
}
