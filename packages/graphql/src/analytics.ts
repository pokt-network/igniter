import { postGraphql } from './client'

// The analytics queries take `suppliers` only: there is no domains / owners / operators variable, so a caller
// cannot widen the selection past the ids it already proved it controls. Plain strings, not codegen documents:
// both roots return a JSON scalar, so the typing comes from the parsers below.
export const analyticsSupplierFunnelQuery = `
  query analyticsSupplierFunnel($suppliers: [String], $rangeStart: Datetime, $rangeEnd: Datetime) {
    funnel: getSupplierSessionFunnelJson(
      suppliers: $suppliers
      rangeStart: $rangeStart
      rangeEnd: $rangeEnd
      bucket: "day"
      byService: true
      bySupplier: true
    )
  }
`

export const analyticsSupplierSessionsQuery = `
  query analyticsSupplierSessions(
    $suppliers: [String]
    $rangeStart: Datetime
    $rangeEnd: Datetime
    $rowLimit: Int
    $beforeHeight: BigInt
    $beforeSessionId: String
  ) {
    sessions: getSupplierSessionListJson(
      suppliers: $suppliers
      rangeStart: $rangeStart
      rangeEnd: $rangeEnd
      rowLimit: $rowLimit
      beforeHeight: $beforeHeight
      beforeSessionId: $beforeSessionId
    )
  }
`

/** The indexer caps a `suppliers` list at 200 ids. */
export const ANALYTICS_MAX_SUPPLIERS = 200

/** Rows per session-list page: the indexer's maximum `rowLimit`. A shorter page is the last one. */
export const ANALYTICS_SESSION_PAGE_SIZE = 1000

/** Numbers come back as JSON strings (amounts, counts, heights) so no precision is lost; they stay strings here. */
export type NumericString = string

/** The `range` envelope of the `_json` roots: the part of the requested range the data covers, half-open. */
export type AnalyticsRange = {
  coveredFrom: string | null
  coveredTo: string | null
  gaps: Array<{ from: string; to: string }>
}

/** One row of getSupplierSessionFunnelJson with bucket day, by service and by supplier. */
export type AnalyticsFunnelRow = {
  bucketStart: string
  serviceId: string
  supplierId: string
  seats: NumericString | null
  paid: NumericString | null
  settledZero: NumericString | null
  expired: NumericString | null
  discarded: NumericString | null
  slashed: NumericString | null
  idleOthersWorked: NumericString | null
  idleNoWork: NumericString | null
  unresolved: NumericString | null
  active: NumericString | null
  paidUpokt: NumericString | null
  equalShareUpokt: NumericString | null
  relays: NumericString | null
  computeUnits: NumericString | null
  sessionsWithSelected: NumericString | null
  poolUpokt: NumericString | null
  rosterSeats: NumericString | null
  networkSessions: NumericString | null
  firstHeight: NumericString | null
  lastHeight: NumericString | null
}

/** One row of getSupplierSessionListJson: a session and the selected members of its roster. */
export type AnalyticsSessionRow = {
  sessionId: string
  applicationId: string
  serviceId: string
  startHeight: NumericString
  endHeight: NumericString | null
  startTime: string
  phase: string
  settlementHeight: NumericString | null
  settledHeight: NumericString | null
  moneyMissing: boolean
  rosterSize: NumericString | null
  candidates: NumericString | null
  claimed: NumericString | null
  paidUpokt: NumericString | null
  settledUpokt: NumericString | null
  relays: NumericString | null
  computeUnits: NumericString | null
  selectedSupplierIds: string[]
  selectedStates: string[]
  selectedPaidUpokt: Array<NumericString | null>
  selectedEqualShareUpokt: Array<NumericString | null>
}

export type AnalyticsFunnelAnswer = { range: AnalyticsRange; rows: AnalyticsFunnelRow[] }
export type AnalyticsSessionPage = { range: AnalyticsRange; rows: AnalyticsSessionRow[] }

type JsonObject = Record<string, unknown>

function fail(what: string, detail: string): never {
  throw new Error(`Unexpected ${what} in the indexer answer: ${detail}`)
}

function asObject(value: unknown, what: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(what, 'not an object')
  return value as JsonObject
}

function text(row: JsonObject, key: string, what: string): string {
  const v = row[key]
  if (typeof v !== 'string' || v === '') fail(what, `${key} is ${JSON.stringify(v)}`)
  return v
}

function nullableText(row: JsonObject, key: string, what: string): string | null {
  const v = row[key]
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') fail(what, `${key} is ${JSON.stringify(v)}`)
  return v
}

function numeric(v: unknown, key: string, what: string): NumericString | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return v
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v)
  return fail(what, `${key} is ${JSON.stringify(v)}`)
}

function num(row: JsonObject, key: string, what: string): NumericString | null {
  return numeric(row[key], key, what)
}

function list(row: JsonObject, key: string, what: string): unknown[] {
  const v = row[key]
  if (!Array.isArray(v)) fail(what, `${key} is not an array`)
  return v
}

function parseEnvelope(value: unknown, what: string): { range: AnalyticsRange; data: unknown[] } {
  const body = asObject(value, what)
  const range = asObject(body.range, `${what} range`)
  if (!Array.isArray(body.data)) fail(what, 'data is not an array')
  const gaps = list(range, 'gaps', `${what} range`).map((g) => {
    const gap = asObject(g, `${what} gap`)
    return { from: text(gap, 'from', `${what} gap`), to: text(gap, 'to', `${what} gap`) }
  })
  return {
    range: {
      coveredFrom: nullableText(range, 'covered_from', `${what} range`),
      coveredTo: nullableText(range, 'covered_to', `${what} range`),
      gaps,
    },
    data: body.data,
  }
}

/** Parses the JSON scalar of getSupplierSessionFunnelJson; throws on any shape it does not expect. */
export function parseSupplierSessionFunnel(value: unknown): AnalyticsFunnelAnswer {
  const what = 'funnel row'
  const { range, data } = parseEnvelope(value, 'funnel')
  const rows = data.map((r): AnalyticsFunnelRow => {
    const row = asObject(r, what)
    return {
      bucketStart: text(row, 'bucket_start', what),
      serviceId: text(row, 'service_id', what),
      supplierId: text(row, 'supplier_id', what),
      seats: num(row, 'seats', what),
      paid: num(row, 'paid', what),
      settledZero: num(row, 'settled_zero', what),
      expired: num(row, 'expired', what),
      discarded: num(row, 'discarded', what),
      slashed: num(row, 'slashed', what),
      idleOthersWorked: num(row, 'idle_others_worked', what),
      idleNoWork: num(row, 'idle_no_work', what),
      unresolved: num(row, 'unresolved', what),
      active: num(row, 'active', what),
      paidUpokt: num(row, 'paid_upokt', what),
      equalShareUpokt: num(row, 'equal_share_upokt', what),
      relays: num(row, 'relays', what),
      computeUnits: num(row, 'compute_units', what),
      sessionsWithSelected: num(row, 'sessions_with_selected', what),
      poolUpokt: num(row, 'pool_upokt', what),
      rosterSeats: num(row, 'roster_seats', what),
      networkSessions: num(row, 'network_sessions', what),
      firstHeight: num(row, 'first_height', what),
      lastHeight: num(row, 'last_height', what),
    }
  })
  return { range, rows }
}

/** Parses the JSON scalar of getSupplierSessionListJson; throws on any shape it does not expect. */
export function parseSupplierSessionList(value: unknown): AnalyticsSessionPage {
  const what = 'session row'
  const { range, data } = parseEnvelope(value, 'session list')
  const rows = data.map((r): AnalyticsSessionRow => {
    const row = asObject(r, what)
    if (typeof row.money_missing !== 'boolean') fail(what, `money_missing is ${JSON.stringify(row.money_missing)}`)
    const selectedSupplierIds = list(row, 'selected_supplier_ids', what).map((v) => {
      if (typeof v !== 'string' || v === '') fail(what, `selected_supplier_ids holds ${JSON.stringify(v)}`)
      return v
    })
    const selectedStates = list(row, 'selected_states', what).map((v) => {
      if (typeof v !== 'string') fail(what, `selected_states holds ${JSON.stringify(v)}`)
      return v
    })
    const selectedPaidUpokt = list(row, 'selected_paid_upokt', what).map((v) => numeric(v, 'selected_paid_upokt', what))
    const selectedEqualShareUpokt = list(row, 'selected_equal_share_upokt', what)
      .map((v) => numeric(v, 'selected_equal_share_upokt', what))
    const n = selectedSupplierIds.length
    if (selectedStates.length !== n || selectedPaidUpokt.length !== n || selectedEqualShareUpokt.length !== n) {
      fail(what, 'selected_* arrays differ in length')
    }
    const startHeight = num(row, 'start_height', what)
    if (startHeight === null) fail(what, 'start_height is null')
    return {
      sessionId: text(row, 'session_id', what),
      applicationId: text(row, 'application_id', what),
      serviceId: text(row, 'service_id', what),
      startHeight,
      endHeight: num(row, 'end_height', what),
      startTime: text(row, 'start_time', what),
      phase: text(row, 'phase', what),
      settlementHeight: num(row, 'settlement_height', what),
      settledHeight: num(row, 'settled_height', what),
      moneyMissing: row.money_missing,
      rosterSize: num(row, 'roster_size', what),
      candidates: num(row, 'candidates', what),
      claimed: num(row, 'claimed', what),
      paidUpokt: num(row, 'paid_upokt', what),
      settledUpokt: num(row, 'settled_upokt', what),
      relays: num(row, 'relays', what),
      computeUnits: num(row, 'compute_units', what),
      selectedSupplierIds,
      selectedStates,
      selectedPaidUpokt,
      selectedEqualShareUpokt,
    }
  })
  return { range, rows }
}

/**
 * Each analytics request gives up after this long, so a hung page fails its activity attempt (and is retried) well
 * inside the 2 m heartbeat timeout instead of writing on after a retry already started.
 */
export const ANALYTICS_FETCH_TIMEOUT_MS = 60_000

function checkSuppliers(suppliers: string[]) {
  // An empty list would read as "no selector" (every supplier of the network): never send one.
  if (suppliers.length === 0) throw new Error('An analytics query needs at least one supplier id')
  if (suppliers.length > ANALYTICS_MAX_SUPPLIERS) {
    throw new Error(`An analytics query takes at most ${ANALYTICS_MAX_SUPPLIERS} supplier ids, got ${suppliers.length}`)
  }
}

/** The per-day funnel of `suppliers` over [rangeStart, rangeEnd), by service and by supplier. */
export async function fetchSupplierSessionFunnel(
  url: string,
  params: { suppliers: string[]; rangeStart: string; rangeEnd: string },
): Promise<AnalyticsFunnelAnswer> {
  checkSuppliers(params.suppliers)
  const data = await postGraphql<{ funnel: unknown }>(url, analyticsSupplierFunnelQuery, params, {
    signal: AbortSignal.timeout(ANALYTICS_FETCH_TIMEOUT_MS),
  })
  return parseSupplierSessionFunnel(data.funnel)
}

/**
 * One page (newest first) of the sessions of `suppliers` that started in [rangeStart, rangeEnd). The next page
 * passes the last row's start height and session id as `before`; a page shorter than ANALYTICS_SESSION_PAGE_SIZE is
 * the last one.
 */
export async function fetchSupplierSessionPage(
  url: string,
  params: {
    suppliers: string[]
    rangeStart: string
    rangeEnd: string
    before?: { height: string; sessionId: string }
  },
): Promise<AnalyticsSessionPage> {
  checkSuppliers(params.suppliers)
  const data = await postGraphql<{ sessions: unknown }>(url, analyticsSupplierSessionsQuery, {
    suppliers: params.suppliers,
    rangeStart: params.rangeStart,
    rangeEnd: params.rangeEnd,
    rowLimit: ANALYTICS_SESSION_PAGE_SIZE,
    beforeHeight: params.before?.height ?? null,
    beforeSessionId: params.before?.sessionId ?? null,
  }, { signal: AbortSignal.timeout(ANALYTICS_FETCH_TIMEOUT_MS) })
  return parseSupplierSessionList(data.sessions)
}

/** A service's reference session start: its own-eligible count is read at this height. */
export type AnalyticsSelectionReferenceInput = { serviceId: string; height: number }

export type AnalyticsSelectionCounts = {
  /** Per service: how many of `suppliers` were eligible at its reference height. */
  ownEligible: Record<string, number>
  /** Per reference height: the session param num_suppliers_per_session (the seats per draw); empty without `withCaps`. */
  caps: Record<number, number>
}

/**
 * The service configs a session at `height` draws from, as pocketdex counts its candidates: live at the start or
 * closed by the start block itself (so read at height - 1), and activated at or below the start, or not activated yet
 * (a stake's config waits for the next session start). The same filter over a service with no `supplierId` gave
 * exactly pocketdex's `candidates` on 21 of 21 (service, day) pairs checked on 2026-10-28.
 */
const eligibleCount = (i: number) =>
  `s${i}: supplierServiceConfigs(blockHeight: $h${i}, filter: { supplierId: { in: $suppliers }, serviceId: { equalTo: $v${i} }, ` +
  `or: [{ activatedAtId: { lessThanOrEqualTo: $a${i} } }, { activatedAtId: { isNull: true } }] }) { totalCount }`

/** The indexer refuses a request with more than 20 aliases ("Alias limit exceeded", measured 2026-10-28). */
export const ANALYTICS_MAX_ALIASES = 20

type SelectionAlias =
  | { kind: 'count'; serviceId: string; height: number }
  | { kind: 'cap'; height: number }

/**
 * The selection model's inputs for `suppliers` (at most 200, our own ids only): per reference, how many of them were
 * eligible for its service at its height, and (with `withCaps`, the default) per height the seats per draw. As few
 * requests as the alias limit allows; they return counts, never a supplier id.
 */
export async function fetchSelectionCounts(
  url: string,
  params: { suppliers: string[]; references: AnalyticsSelectionReferenceInput[]; withCaps?: boolean },
): Promise<AnalyticsSelectionCounts> {
  checkSuppliers(params.suppliers)
  const heights = params.withCaps === false ? [] : [...new Set(params.references.map((r) => r.height))]
  const aliases: SelectionAlias[] = [
    ...params.references.map((r) => ({ kind: 'count' as const, serviceId: r.serviceId, height: r.height })),
    ...heights.map((height) => ({ kind: 'cap' as const, height })),
  ]
  const ownEligible: Record<string, number> = {}
  const caps: Record<number, number> = {}
  for (let start = 0; start < aliases.length; start += ANALYTICS_MAX_ALIASES) {
    const part = aliases.slice(start, start + ANALYTICS_MAX_ALIASES)
    const hasCount = part.some((a) => a.kind === 'count')
    const declarations: string[] = hasCount ? ['$suppliers: [String!]!'] : []
    const fields: string[] = []
    const variables: Record<string, unknown> = hasCount ? { suppliers: params.suppliers } : {}
    // Counts are s0.., caps c0.., each numbered within the request.
    const index = (a: SelectionAlias) => part.filter((b) => b.kind === a.kind).indexOf(a)
    part.forEach((a) => {
      const i = index(a)
      if (a.kind === 'count') {
        declarations.push(`$h${i}: String!`, `$v${i}: String!`, `$a${i}: BigFloat!`)
        fields.push(eligibleCount(i))
        variables[`h${i}`] = String(a.height - 1)
        variables[`v${i}`] = a.serviceId
        variables[`a${i}`] = String(a.height)
      } else {
        declarations.push(`$c${i}: String!`)
        fields.push(`c${i}: params(blockHeight: $c${i}, filter: { key: { equalTo: "num_suppliers_per_session" }, namespace: { equalTo: "session" } }) { nodes { value } }`)
        variables[`c${i}`] = String(a.height)
      }
    })
    const query = `query analyticsSelectionCounts(${declarations.join(', ')}) { ${fields.join(' ')} }`
    const data = await postGraphql<Record<string, { totalCount?: number; nodes?: Array<{ value: string }> }>>(url, query, variables, {
      signal: AbortSignal.timeout(ANALYTICS_FETCH_TIMEOUT_MS),
    })
    part.forEach((a) => {
      const i = index(a)
      if (a.kind === 'count') {
        const count = data[`s${i}`]?.totalCount
        if (!Number.isInteger(count)) throw new Error(`Indexer selection counts: no totalCount for service ${a.serviceId}`)
        ownEligible[a.serviceId] = count!
      } else {
        const value = Number(data[`c${i}`]?.nodes?.[0]?.value)
        if (!Number.isInteger(value) || value < 1) throw new Error(`Indexer selection counts: no num_suppliers_per_session at ${a.height}`)
        caps[a.height] = value
      }
    })
  }
  return { ownEligible, caps }
}
