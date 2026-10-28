/*
 * The Analytics page's arithmetic over stored day data. Amounts are upokt: summed as BigInt, divided as numbers.
 * Y = what the provider's suppliers were paid; B = their equal share (each session's V over its roster size, per
 * seat); F = Y / B. Presence = distinct own sessions / network sessions.
 */

const DAY_MS = 86_400_000

export function toBig(v: string | number | bigint | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return 0n
  if (typeof v === 'bigint') return v
  return BigInt(typeof v === 'number' ? Math.trunc(v) : v.split('.')[0]!)
}

/** n / d rounded half away from zero, exactly (d must not be zero). */
export function roundDiv(n: bigint, d: bigint): bigint {
  const negative = (n < 0n) !== (d < 0n)
  const an = n < 0n ? -n : n
  const ad = d < 0n ? -d : d
  const q = (an * 2n + ad) / (2n * ad)
  return negative ? -q : q
}

/** n / d to `decimals` places, rounded half away from zero, as an exact decimal string: no float on the way. */
export function decimalString(n: bigint, d: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const q = roundDiv(n * scale, d)
  const abs = q < 0n ? -q : q
  const fraction = decimals > 0 ? `.${(abs % scale).toString().padStart(decimals, '0')}` : ''
  return `${q < 0n ? '-' : ''}${abs / scale}${fraction}`
}

/** a / b as a number; null when b is zero. Rounded half away from zero at 9 decimals, before any float. */
export function ratio(a: bigint, b: bigint): number | null {
  if (b === 0n) return null
  // Scale to keep 9 decimals without converting two huge bigints to floats first.
  return Number(roundDiv(a * 1_000_000_000n, b)) / 1_000_000_000
}

export function sumBig(values: Array<string | number | bigint | null | undefined>): bigint {
  return values.reduce<bigint>((acc, v) => acc + toBig(v), 0n)
}

/** F as "% vs equal share": +5% above, −30% below. */
export function percentVsEqualShare(f: number | null): number | null {
  return f === null ? null : (f - 1) * 100
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS))
}

/** The days of [from, to], inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** mulberry32: a small seeded PRNG, so the bootstrap gives the same range on every render. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The 95% range needs at least this many days with an equal share, and this many sessions with one, as in
 * @mykyal's fleet analysis: below that, a few similar days give a narrow range that looks more certain than it is.
 */
export const RANGE_MIN_DAYS = 7
export const RANGE_MIN_SESSIONS = 24

export function hasRangeEvidence(informativeDays: number, positiveSessions: number): boolean {
  return informativeDays >= RANGE_MIN_DAYS && positiveSessions >= RANGE_MIN_SESSIONS
}

export const BOOTSTRAP_RESAMPLES = 2000
export const BOOTSTRAP_SEED = 20261025

/**
 * 95% range of F by a day bootstrap: draw the days with replacement, take ΣY / ΣB of the draw, repeat, and keep
 * the 2.5th and 97.5th percentiles. Needs at least 2 days with an equal share.
 */
export function bootstrapF(
  days: Array<{ y: bigint; b: bigint }>,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): { low: number; high: number } | null {
  const usable = days.filter((d) => d.b > 0n)
  if (usable.length < 2) return null
  // Doubles are fine inside a resample: the totals are compared, not shown.
  const ys = usable.map((d) => Number(d.y))
  const bs = usable.map((d) => Number(d.b))
  const random = seededRandom(seed)
  const fs: number[] = []
  for (let r = 0; r < resamples; r++) {
    let y = 0
    let b = 0
    for (let i = 0; i < usable.length; i++) {
      const j = Math.floor(random() * usable.length)
      y += ys[j]!
      b += bs[j]!
    }
    fs.push(y / b)
  }
  fs.sort((a, b) => a - b)
  const at = (q: number) => fs[Math.min(fs.length - 1, Math.max(0, Math.round(q * (fs.length - 1))))]!
  return { low: at(0.025), high: at(0.975) }
}

export type DayServiceTotals = {
  day: string
  serviceId: string
  /** Y and B, upokt strings. */
  paidUpokt: string
  equalShareUpokt: string
  seats: number
  paid: number
  /** Distinct own sessions of that (day, service), their V and K, and own members. */
  sessions: number
  /** Of those sessions, the ones with a positive pool V, so a positive equal share. */
  positiveSessions: number
  poolUpokt: string
  rosterSeats: number
  members: number
  networkSessions: number
}

export type AnalyticsSummary = {
  y: string
  b: string
  f: number | null
  percentVsEqualShare: number | null
  /** Null below the evidence the range needs (`rangeEvidence`): too few days or sessions with an equal share. */
  range: { low: number; high: number } | null
  /** Days with an equal share (B > 0) and sessions with one, against what the range needs. */
  rangeEvidence: { informativeDays: number; positiveSessions: number; enough: boolean }
  sessions: number
  networkSessions: number
  /**
   * Presence and mean selected use closed days only: on an open day the session list is newer than the funnel's
   * network_sessions, so own sessions can exceed it. `presenceDays` is how many closed days they cover.
   */
  presence: number | null
  meanSelected: number | null
  presenceDays: number
  presenceSessions: number
  presenceNetworkSessions: number
  /** Closed days with more own sessions than network sessions: a data error; presence is clamped to 100%. */
  presenceErrorDays: string[]
  members: number
  seats: number
  paid: number
  poolUpokt: string
  rosterSeats: number
  days: number
  daily: Array<{ day: string; y: string; b: string }>
  /** Per service; `days`: the days it has a row in. */
  services: Array<{ serviceId: string; y: string; b: string; f: number | null; sessions: number; days: number }>
}

/** Summary of the selected (day, service) totals: S1 to S4. `closedDays`: the days whose every state is closed. */
export function summarize(rows: DayServiceTotals[], closedDays: Set<string>): AnalyticsSummary {
  const y = sumBig(rows.map((r) => r.paidUpokt))
  const b = sumBig(rows.map((r) => r.equalShareUpokt))
  const f = ratio(y, b)
  const sessions = rows.reduce((a, r) => a + r.sessions, 0)
  const networkSessions = rows.reduce((a, r) => a + r.networkSessions, 0)
  const members = rows.reduce((a, r) => a + r.members, 0)

  const closed = rows.filter((r) => closedDays.has(r.day))
  const perClosedDay = new Map<string, { sessions: number; network: number }>()
  for (const r of closed) {
    const d = perClosedDay.get(r.day) ?? { sessions: 0, network: 0 }
    perClosedDay.set(r.day, { sessions: d.sessions + r.sessions, network: d.network + r.networkSessions })
  }
  const presenceSessions = closed.reduce((a, r) => a + r.sessions, 0)
  const presenceNetworkSessions = closed.reduce((a, r) => a + r.networkSessions, 0)
  const presenceMembers = closed.reduce((a, r) => a + r.members, 0)
  const presenceErrorDays = [...perClosedDay].filter(([, d]) => d.sessions > d.network).map(([day]) => day).sort()

  const byDay = new Map<string, { y: bigint; b: bigint }>()
  const byService = new Map<string, { y: bigint; b: bigint; sessions: number; days: Set<string> }>()
  for (const r of rows) {
    const ry = toBig(r.paidUpokt)
    const rb = toBig(r.equalShareUpokt)
    const d = byDay.get(r.day) ?? { y: 0n, b: 0n }
    byDay.set(r.day, { y: d.y + ry, b: d.b + rb })
    const s = byService.get(r.serviceId) ?? { y: 0n, b: 0n, sessions: 0, days: new Set<string>() }
    s.days.add(r.day)
    byService.set(r.serviceId, { y: s.y + ry, b: s.b + rb, sessions: s.sessions + r.sessions, days: s.days })
  }

  const informativeDays = [...byDay.values()].filter((d) => d.b > 0n).length
  const positiveSessions = rows.reduce((a, r) => a + r.positiveSessions, 0)
  const enough = hasRangeEvidence(informativeDays, positiveSessions)

  return {
    y: y.toString(),
    b: b.toString(),
    f,
    percentVsEqualShare: percentVsEqualShare(f),
    range: enough ? bootstrapF([...byDay.values()]) : null,
    rangeEvidence: { informativeDays, positiveSessions, enough },
    sessions,
    networkSessions,
    presence: presenceNetworkSessions > 0 ? Math.min(1, presenceSessions / presenceNetworkSessions) : null,
    meanSelected: presenceSessions > 0 ? presenceMembers / presenceSessions : null,
    presenceDays: perClosedDay.size,
    presenceSessions,
    presenceNetworkSessions,
    presenceErrorDays,
    members,
    seats: rows.reduce((a, r) => a + r.seats, 0),
    paid: rows.reduce((a, r) => a + r.paid, 0),
    poolUpokt: sumBig(rows.map((r) => r.poolUpokt)).toString(),
    rosterSeats: rows.reduce((a, r) => a + r.rosterSeats, 0),
    days: byDay.size,
    daily: [...byDay.keys()].sort().map((day) => ({ day, y: byDay.get(day)!.y.toString(), b: byDay.get(day)!.b.toString() })),
    services: [...byService]
      .map(([serviceId, s]) => ({ serviceId, y: s.y.toString(), b: s.b.toString(), f: ratio(s.y, s.b), sessions: s.sessions, days: s.days.size }))
      .sort((a, c) => (toBig(c.y) > toBig(a.y) ? 1 : toBig(c.y) < toBig(a.y) ? -1 : a.serviceId.localeCompare(c.serviceId))),
  }
}
