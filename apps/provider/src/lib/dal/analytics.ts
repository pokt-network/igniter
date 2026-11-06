import 'server-only'
import { getDb } from '@/db'
import { sql, type SQL } from 'drizzle-orm'
import { ANALYTICS_KEY_OWNER_SQL, ANALYTICS_VERIFIED_KEY_STATES, analyticsDayVersionSql, analyticsStaleRollupDaysSql } from '@igniter/db/provider/schema'
import type { AnalyticsKey } from '@/lib/analytics/scope'
import type { AnalyticsDayCoverage } from '@/lib/analytics/coverage'
import type { DayServiceTotals } from '@/lib/analytics/math'

/*
 * Reads of the analytics day tables for the Analytics page. Nothing here calls the indexer: the provider-workflows sync
 * writes these tables. Every query filters the day range first (the member table holds a row per own seat), then
 * the services and the provider's verified suppliers. Amounts stay upokt strings.
 *
 * sessions_with_selected, pool_upokt and roster_seats of analytics_supplier_day are per supplier and are never summed
 * here: distinct sessions, V and K always come from analytics_session rows with at least one member in scope.
 */

export type AnalyticsFilter = {
  from: string
  to: string
  /** Services to keep; null = all. */
  services: string[] | null
  /** The provider's verified suppliers. Every member and supplier row read is one of them: no other is counted. */
  suppliers: string[]
  /**
   * True when the stored rows of the period hold no supplier outside `suppliers`: then every stored session has a
   * member in scope, so session-level numbers come from analytics_session alone instead of scanning the member rows.
   */
  wholeSessions: boolean
}

type Row = Record<string, unknown>

async function rows<T = Row>(query: SQL): Promise<T[]> {
  const result = await getDb().execute(query)
  return result.rows as T[]
}

/** One array parameter (drizzle would otherwise expand a JS array into a parameter list). */
const arr = (values: string[]) => sql.param(values)

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const str = (v: unknown) => (v === null || v === undefined ? '0' : String(v))
const nullableStr = (v: unknown) => (v === null || v === undefined ? null : String(v))

/** `AND <service filter> AND <supplier scope>` over a supplier column and a service column. */
function scopeFilter(f: AnalyticsFilter, supplierCol: SQL, serviceCol: SQL): SQL {
  const parts: SQL[] = []
  if (f.services) parts.push(sql`and ${serviceCol} = any(${arr(f.services)}::text[])`)
  parts.push(sql`and ${supplierCol} = any(${arr(f.suppliers)}::text[])`)
  return sql.join(parts, sql` `)
}

function supplierDayWhere(f: AnalyticsFilter): SQL {
  return sql`d.day between ${f.from} and ${f.to} ${scopeFilter(f, sql`d.supplier_id`, sql`d.service_id`)}`
}

/** The sessions of the period (and services), from analytics_session alone: only when `wholeSessions`. */
function sessionWhere(f: AnalyticsFilter, alias = 's'): SQL {
  const a = sql.raw(alias)
  return sql`${a}.day between ${f.from} and ${f.to} ${f.services ? sql`and ${a}.service_id = any(${arr(f.services)}::text[])` : sql``}`
}

/** The own members in scope, each with its session: the base of every session-level number. */
function ownMembers(f: AnalyticsFilter): SQL {
  return sql`own_m as (
    select m.session_id, m.supplier_id, m.paid_upokt, m.equal_share_upokt,
           s.day, s.service_id, s.application_id, s.paid_upokt as v
    from analytics_session_member m
    join analytics_session s on s.session_id = m.session_id
    where m.day between ${f.from} and ${f.to} ${scopeFilter(f, sql`m.supplier_id`, sql`s.service_id`)}
  )`
}

/** The members of one session that are in the scope (for a session row of a list). */
function memberInScope(f: AnalyticsFilter, sessionAlias: SQL): SQL {
  return sql`m.session_id = ${sessionAlias}.session_id ${scopeFilter(f, sql`m.supplier_id`, sql`${sessionAlias}.service_id`)}`
}

/** The provider's verified suppliers (retired ones included), with what the scope needs. */
export async function listAnalyticsKeys(): Promise<AnalyticsKey[]> {
  const result = await rows<{ address: string; ownerAddress: string | null; retired_at: Date | null; services: AnalyticsKey['services'] }>(sql`
    select address, "ownerAddress", retired_at, services
    from keys
    where state = any(${arr(ANALYTICS_VERIFIED_KEY_STATES)}::address_states[])
    order by address`)
  return result.map((r) => ({ address: r.address, ownerAddress: r.ownerAddress, retiredAt: r.retired_at, services: r.services }))
}

/** The services that have stored network data since `from`. */
export async function listAnalyticsServices(from: string): Promise<string[]> {
  const result = await rows<{ service_id: string }>(sql`
    select distinct service_id from analytics_service_day where day >= ${from} order by service_id`)
  return result.map((r) => r.service_id)
}

/** The oldest day any state row exists for: the first day a custom range can start. */
export async function analyticsOldestDay(): Promise<string | null> {
  const result = await rows<{ day: string | null }>(sql`select min(day)::text as day from analytics_supplier_day_state`)
  return result[0]?.day ?? null
}

/** One service's selection model reference: its latest closed day in the period with a current reference row. */
export type AnalyticsSelectionReferenceRow = {
  serviceId: string
  day: string
  height: number
  candidates: number
  cap: number
  ownEligible: number
}

/**
 * Per service of the period (and filter): the selection reference of its latest closed day. A row counts only while
 * its day is closed and still has the version it was counted under (analyticsDayVersionSql: the day's suppliers and
 * their verified state), so it never describes another set of suppliers than the page's; and only with no more own
 * eligible than candidates, which the model needs.
 */
export async function analyticsSelectionReferences(f: Pick<AnalyticsFilter, 'from' | 'to' | 'services'>): Promise<AnalyticsSelectionReferenceRow[]> {
  const result = await rows<{ service_id: string; day: string; height: string; candidates: number; cap: number; own_eligible: number }>(sql`
    select distinct on (r.service_id) r.service_id, r.day::text as day, r.height, r.candidates, r.cap, r.own_eligible
    from analytics_selection_reference r
    where r.day between ${f.from} and ${f.to}
      ${f.services ? sql`and r.service_id = any(${arr(f.services)}::text[])` : sql``}
      and r.own_eligible <= r.candidates
      and not exists (select 1 from analytics_supplier_day_state s where s.day = r.day and not s.closed)
      and r.version = ${sql.raw(analyticsDayVersionSql('r.day'))}
    order by r.service_id, r.day desc`)
  return result.map((r) => ({
    serviceId: r.service_id,
    day: r.day,
    height: num(r.height),
    candidates: num(r.candidates),
    cap: num(r.cap),
    ownEligible: num(r.own_eligible),
  }))
}

/** Per day of the period: the scope suppliers' state rows and whether all are closed. */
export async function analyticsDayCoverage(from: string, to: string, suppliers: string[] | null): Promise<AnalyticsDayCoverage[]> {
  const result = await rows<{ day: string; states: string; closed: boolean }>(sql`
    select day::text as day, count(*) as states, bool_and(closed) as closed
    from analytics_supplier_day_state
    where day between ${from} and ${to} ${suppliers ? sql`and supplier_id = any(${arr(suppliers)}::text[])` : sql``}
    group by day order by day`)
  return result.map((r) => ({ day: r.day, states: num(r.states), closed: r.closed }))
}

/** Whether the period's stored rows hold any supplier outside `suppliers` (a key no longer verified, or out of scope). */
export async function analyticsHasOtherSuppliers(from: string, to: string, suppliers: string[]): Promise<boolean> {
  const result = await rows<{ other: boolean }>(sql`
    select exists (
      select 1 from analytics_supplier_day_state
      where day between ${from} and ${to} and not (supplier_id = any(${arr(suppliers)}::text[]))
    ) as other`)
  return Boolean(result[0]?.other)
}

/**
 * Totals per (day, service) of the scope: Y, B, seats and paid from the supplier rows; distinct own sessions, V, K
 * and members from the session rows; network_sessions once per (day, service).
 */
export async function analyticsDayServiceTotals(f: AnalyticsFilter): Promise<DayServiceTotals[]> {
  const [money, sessions, network] = await Promise.all([
    rows(sql`
      select d.day::text as day, d.service_id,
             sum(d.paid_upokt) as y, sum(d.equal_share_upokt) as b, sum(d.seats) as seats, sum(d.paid) as paid,
             sum(coalesce(d.seats, 0) + coalesce(d.active, 0)) as members
      from analytics_supplier_day d
      where ${supplierDayWhere(f)}
      group by 1, 2`),
    f.wholeSessions
      // Every stored session has a member in scope: count them, and their V and K, without the member rows.
      ? rows(sql`
          select s.day::text as day, s.service_id, count(*) as sessions, count(*) filter (where s.paid_upokt > 0) as positive,
                 sum(s.paid_upokt) as v, sum(s.roster_size) as k
          from analytics_session s where ${sessionWhere(f)}
          group by 1, 2`)
      : rows(sql`
          with ${ownMembers(f)},
          per as (select session_id, count(*) as x from own_m group by session_id)
          select s.day::text as day, s.service_id,
                 count(*) as sessions, count(*) filter (where s.paid_upokt > 0) as positive,
                 sum(s.paid_upokt) as v, sum(s.roster_size) as k, sum(per.x) as members
          from per join analytics_session s on s.session_id = per.session_id
          group by 1, 2`),
    rows(sql`
      select day::text as day, service_id, network_sessions
      from analytics_service_day
      where day between ${f.from} and ${f.to}
      ${f.services ? sql`and service_id = any(${arr(f.services)}::text[])` : sql``}`),
  ])

  const out = new Map<string, DayServiceTotals>()
  const at = (day: string, serviceId: string) => {
    const key = `${day}\n${serviceId}`
    let r = out.get(key)
    if (!r) {
      out.set(key, (r = {
        day, serviceId, paidUpokt: '0', equalShareUpokt: '0', seats: 0, paid: 0,
        sessions: 0, positiveSessions: 0, poolUpokt: '0', rosterSeats: 0, members: 0, networkSessions: 0,
      }))
    }
    return r
  }
  for (const r of money) {
    Object.assign(at(String(r.day), String(r.service_id)), {
      paidUpokt: str(r.y), equalShareUpokt: str(r.b), seats: num(r.seats), paid: num(r.paid),
      // Own members (seats of every state) from the supplier rows; the member rows give the same count when read.
      ...(f.wholeSessions ? { members: num(r.members) } : {}),
    })
  }
  for (const r of sessions) {
    Object.assign(at(String(r.day), String(r.service_id)), {
      sessions: num(r.sessions), positiveSessions: num(r.positive), poolUpokt: str(r.v), rosterSeats: num(r.k),
      ...(f.wholeSessions ? {} : { members: num(r.members) }),
    })
  }
  for (const r of network) at(String(r.day), String(r.service_id)).networkSessions = num(r.network_sessions)
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day) || a.serviceId.localeCompare(b.serviceId))
}

export const ANALYTICS_BREAKDOWN_DIMENSIONS = ['service', 'supplier', 'owner', 'week', 'application', 'selected', 'value'] as const
export type AnalyticsBreakdownDimension = typeof ANALYTICS_BREAKDOWN_DIMENSIONS[number]

export type AnalyticsGroupRow = {
  key: string
  y: string
  b: string
  sessions: number
  days: number
  /** Session value band only: its V range, upokt. */
  minV?: string | null
  maxV?: string | null
}

/** The stake owner on chain; the owner the key was delivered to when the chain owner is not known yet. */
const OWNER = sql.raw(ANALYTICS_KEY_OWNER_SQL)

/**
 * The first day of the 7-day block of the period a day falls in, the blocks counted from the period's first day
 * (the last one shorter): the weeks of the Summary chart, by date arithmetic (no time zone involved).
 */
const weekBlock = (day: SQL, from: string) => sql`(${from}::date + ((${day} - ${from}::date) / 7) * 7)::text`

/**
 * The period's days whose rollups are not current (the shared stale-day rule, analyticsStaleRollupDaysSql): readers count
 * them from their member rows.
 */
async function staleRollupDays(f: AnalyticsFilter): Promise<string[]> {
  const result = await rows<{ day: string }>(analyticsStaleRollupDaysSql({ from: f.from, to: f.to }, 'read'))
  return result.map((r) => r.day)
}

/**
 * Distinct sessions per owner. With `wholeSessions` every stored member is in scope, so the per-day rollup counts
 * them (stale days are counted from their member rows instead); otherwise from the member rows in scope.
 */
async function ownerSessions(f: AnalyticsFilter): Promise<SQL> {
  const live = (days: SQL) => sql`
    select ${OWNER} as g, count(distinct m.session_id) as sessions
    from analytics_session_member m
    join analytics_session s on s.session_id = m.session_id
    join keys k on k.address = m.supplier_id
    where ${days} ${scopeFilter(f, sql`m.supplier_id`, sql`s.service_id`)}
    group by 1`
  if (!f.wholeSessions) return live(sql`m.day between ${f.from} and ${f.to}`)
  const missing = await staleRollupDays(f)
  // A stale day is counted from its member rows only, never from its old rollup too.
  const rolled = sql`
    select owner_address as g, sum(sessions) as sessions from analytics_owner_day o
    where o.day between ${f.from} and ${f.to} ${f.services ? sql`and o.service_id = any(${arr(f.services)}::text[])` : sql``}
    ${missing.length > 0 ? sql`and not (o.day = any(${arr(missing)}::date[]))` : sql``}
    group by 1`
  if (missing.length === 0) return rolled
  return sql`select g, sum(sessions) as sessions from (${rolled} union all ${live(sql`m.day = any(${arr(missing)}::date[])`)}) u group by g`
}

/**
 * The scope's sessions as `per (session_id, day, application_id, v, settled, x, y, b)`: X own members, their Y and B. With
 * `wholeSessions` they are the day rebuild's own_* columns of analytics_session (stale days are counted from their
 * member rows instead); otherwise from the member rows in scope.
 */
async function perSession(f: AnalyticsFilter): Promise<SQL> {
  const live = (days: SQL) => sql`
    select m.session_id, s.day, s.application_id, max(s.paid_upokt) as v, bool_and(s.phase = 'settled') as settled,
           count(*) as x, sum(m.paid_upokt) as y, sum(m.equal_share_upokt) as b
    from analytics_session_member m
    join analytics_session s on s.session_id = m.session_id
    where ${days} ${scopeFilter(f, sql`m.supplier_id`, sql`s.service_id`)}
    group by m.session_id, s.day, s.application_id`
  if (!f.wholeSessions) return sql`per as (${live(sql`m.day between ${f.from} and ${f.to}`)})`
  const missing = await staleRollupDays(f)
  const rolled = sql`
    select s.session_id, s.day, s.application_id, s.paid_upokt as v, s.phase = 'settled' as settled,
           s.own_members as x, s.own_paid_upokt as y, s.own_equal_share_upokt as b
    from analytics_session s
    where ${sessionWhere(f)} and s.own_members > 0
    ${missing.length > 0 ? sql`and not (s.day = any(${arr(missing)}::date[]))` : sql``}`
  if (missing.length === 0) return sql`per as (${rolled})`
  return sql`per as (${rolled} union all ${live(sql`m.day = any(${arr(missing)}::date[])`)})`
}

/** Y, B, sessions and days per group of one dimension. */
export async function analyticsBreakdown(f: AnalyticsFilter, dim: AnalyticsBreakdownDimension): Promise<AnalyticsGroupRow[]> {
  let result: Row[]
  if (dim === 'supplier') {
    // A supplier's sessions are its own sessions_with_selected: days and services hold disjoint sessions.
    result = await rows(sql`
      select d.supplier_id as g, sum(d.paid_upokt) as y, sum(d.equal_share_upokt) as b,
             sum(d.sessions_with_selected) as sessions, count(distinct d.day) as days
      from analytics_supplier_day d where ${supplierDayWhere(f)}
      group by 1`)
  } else if (dim === 'owner') {
    result = await rows(sql`
      with per_supplier_day as (
        select d.supplier_id, d.day, sum(d.paid_upokt) as y, sum(d.equal_share_upokt) as b
        from analytics_supplier_day d where ${supplierDayWhere(f)}
        group by 1, 2),
      money as (
        select ${OWNER} as g, sum(p.y) as y, sum(p.b) as b, count(distinct p.day) as days
        from per_supplier_day p left join keys k on k.address = p.supplier_id
        group by 1),
      ses as (${await ownerSessions(f)})
      select money.g, money.y, money.b, money.days, coalesce(ses.sessions, 0) as sessions
      from money left join ses on ses.g = money.g`)
  } else if (dim === 'service' || dim === 'week') {
    const g = dim === 'service' ? { d: sql`d.service_id`, s: sql`s.service_id` } : { d: weekBlock(sql`d.day`, f.from), s: weekBlock(sql`s.day`, f.from) }
    // Distinct sessions from analytics_session alone when every stored session is in scope, else from the members in scope.
    const ses = f.wholeSessions
      ? sql`select ${g.s} as g, count(*) as sessions from analytics_session s where ${sessionWhere(f)} group by 1`
      : sql`select ${g.s} as g, count(*) as sessions from analytics_session s
            where ${sessionWhere(f)} and exists (select 1 from analytics_session_member m where ${memberInScope(f, sql`s`)})
            group by 1`
    result = await rows(sql`
      with money as (
        select ${g.d} as g, sum(d.paid_upokt) as y, sum(d.equal_share_upokt) as b, count(distinct d.day) as days
        from analytics_supplier_day d where ${supplierDayWhere(f)}
        group by 1),
      ses as (${ses})
      select money.g, money.y, money.b, money.days, coalesce(ses.sessions, 0) as sessions
      from money left join ses on ses.g = money.g`)
  } else {
    // Per session first: own members X, their Y and B, the session's V and application.
    const per = await perSession(f)
    result = dim === 'application'
      ? await rows(sql`
          with ${per}
          select application_id as g, sum(y) as y, sum(b) as b, count(*) as sessions, count(distinct day) as days
          from per group by 1`)
      : dim === 'selected'
        ? await rows(sql`
            with ${per}
            select x::text as g, sum(y) as y, sum(b) as b, count(*) as sessions, count(distinct day) as days
            from per group by x`)
        : await rows(sql`
            with ${per},
            banded as (
              select *, case when v is not null then (ntile(4) over (partition by v is null order by v))::text
                             when settled then 'no_payout' else 'not_settled' end as band
              from per)
            select band as g, sum(y) as y, sum(b) as b, count(*) as sessions, count(distinct day) as days,
                   min(v) as min_v, max(v) as max_v
            from banded group by band`)
  }

  const groups: AnalyticsGroupRow[] = result.map((r) => ({
    key: String(r.g ?? ''),
    y: str(r.y),
    b: str(r.b),
    sessions: num(r.sessions),
    days: num(r.days),
    ...(dim === 'value' ? { minV: nullableStr(r.min_v), maxV: nullableStr(r.max_v) } : {}),
  }))
  const ordered = dim === 'week' || dim === 'selected' || dim === 'value'
  return groups.sort((a, b) => ordered
    ? (dim === 'selected' ? Number(a.key) - Number(b.key) : a.key.localeCompare(b.key))
    : (BigInt(b.y) > BigInt(a.y) ? 1 : BigInt(b.y) < BigInt(a.y) ? -1 : a.key.localeCompare(b.key)))
}

export type AnalyticsSessionRow = {
  sessionId: string
  day: string
  startHeight: number
  serviceId: string
  applicationId: string
  phase: string
  moneyMissing: boolean
  rosterSize: number | null
  candidates: number | null
  /** V: what the session paid every member. Null until it settles with its money. */
  poolUpokt: string | null
  /** The scope's members of the session, their Y and B. */
  members: number
  paidUpokt: string
  equalShareUpokt: string
}

function sessionRow(r: Row): AnalyticsSessionRow {
  return {
    sessionId: String(r.session_id),
    day: String(r.day),
    startHeight: num(r.start_height),
    serviceId: String(r.service_id),
    applicationId: String(r.application_id),
    phase: String(r.phase),
    moneyMissing: Boolean(r.money_missing),
    rosterSize: r.roster_size === null ? null : num(r.roster_size),
    candidates: r.candidates === null ? null : num(r.candidates),
    poolUpokt: nullableStr(r.v),
    members: num(r.x),
    paidUpokt: str(r.y),
    equalShareUpokt: str(r.b),
  }
}

export const ANALYTICS_SESSION_PHASES = ['all', 'settled', 'in_progress', 'money_missing'] as const
/**
 * The Sessions list filter: settled (with its money), in progress (not settled yet: active, grace, waiting for
 * claims or proofs, claiming, proving, overdue), or settled with its money missing. The three make up all.
 */
export type AnalyticsSessionPhase = typeof ANALYTICS_SESSION_PHASES[number]

function phaseWhere(phase: AnalyticsSessionPhase, a: SQL): SQL {
  switch (phase) {
    case 'settled': return sql`and ${a}.phase = 'settled' and not ${a}.money_missing`
    case 'in_progress': return sql`and ${a}.phase <> 'settled'`
    case 'money_missing': return sql`and ${a}.phase = 'settled' and ${a}.money_missing`
    default: return sql``
  }
}

/** The members of a session that count: verified suppliers of the page scope. Their count, Y and B. */
function scopedMemberTotals(f: AnalyticsFilter, a: SQL): SQL {
  return sql`(select count(*) as x, sum(m.paid_upokt) as y, sum(m.equal_share_upokt) as b
    from analytics_session_member m where ${memberInScope(f, a)})`
}

/**
 * The scope's sessions of one phase, newest first: those with a member in scope, each with the count, Y and B of
 * its members in scope only.
 */
export async function listAnalyticsSessions(
  f: AnalyticsFilter,
  page: { offset: number; limit: number; phase: AnalyticsSessionPhase },
): Promise<{ total: number; rows: AnalyticsSessionRow[] }> {
  const s = sql.raw('s')
  const where = sql`${sessionWhere(f)} ${phaseWhere(page.phase, s)}
    ${f.wholeSessions ? sql`` : sql`and exists (select 1 from analytics_session_member m where ${memberInScope(f, s)})`}`
  const [count, list] = await Promise.all([
    rows<{ total: string }>(sql`select count(*) as total from analytics_session s where ${where}`),
    rows(sql`
      with page as (
        select * from analytics_session s where ${where}
        order by s.start_height desc, s.session_id desc limit ${page.limit} offset ${page.offset})
      select s.session_id, s.day::text as day, s.start_height, s.service_id, s.application_id, s.phase, s.money_missing,
             s.roster_size, s.candidates, s.paid_upokt as v, t.x, t.y, t.b
      from page s cross join lateral ${scopedMemberTotals(f, s)} t
      order by s.start_height desc, s.session_id desc`),
  ])
  return { total: num(count[0]?.total), rows: list.map(sessionRow) }
}

export type AnalyticsSessionMember = { supplierId: string; state: string; paidUpokt: string | null; equalShareUpokt: string | null }

/**
 * One session and its members in the page scope only (verified suppliers of the selected services): never a
 * supplier the provider does not hold. Null when the session has no member in scope.
 */
export async function getAnalyticsSession(
  f: AnalyticsFilter,
  sessionId: string,
): Promise<{ session: AnalyticsSessionRow; members: AnalyticsSessionMember[] } | null> {
  const s = sql.raw('s')
  const [session, members] = await Promise.all([
    rows(sql`
      select s.session_id, s.day::text as day, s.start_height, s.service_id, s.application_id, s.phase, s.money_missing,
             s.roster_size, s.candidates, s.paid_upokt as v, t.x, t.y, t.b
      from analytics_session s cross join lateral ${scopedMemberTotals(f, s)} t
      where s.session_id = ${sessionId}`),
    rows(sql`
      select m.supplier_id, m.state, m.paid_upokt, m.equal_share_upokt
      from analytics_session_member m join analytics_session s on s.session_id = m.session_id
      where ${memberInScope(f, s)} and s.session_id = ${sessionId}
      order by m.supplier_id`),
  ])
  if (!session[0] || num(session[0].x) === 0) return null
  return {
    session: sessionRow(session[0]),
    members: members.map((m) => ({
      supplierId: String(m.supplier_id),
      state: String(m.state),
      paidUpokt: nullableStr(m.paid_upokt),
      equalShareUpokt: nullableStr(m.equal_share_upokt),
    })),
  }
}
