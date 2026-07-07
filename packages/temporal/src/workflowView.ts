import type {
  Client,
  WorkflowExecutionInfo,
  WorkflowExecutionStatusName,
  ScheduleSummary,
  ScheduleDescription,
} from '@temporalio/client'

// Type-only import from workflowDetail is erased at runtime (no require-cycle);
// the value import below is what actually loads the module.
import { TEMPORAL_SCHEDULED_BY_ID } from '@/workflowDetail'
import { evaluateLiveness, defaultHealState, type Verdict, type WatchdogEntry } from '@/scheduleWatchdog'

export { TEMPORAL_SCHEDULED_BY_ID }

export type WorkflowStatus = WorkflowExecutionStatusName

export interface WorkflowView {
  workflowId: string
  runId: string
  type: string
  status: WorkflowStatus
  /** ISO-8601 start time */
  startTime: string
  /** ISO-8601 close time for terminal workflows, else null */
  closeTime: string | null
  /** For running: now - start. For terminal: close - start. */
  elapsedMs: number
  /** TemporalScheduledById[0] from search attributes, or null if not schedule-started. */
  scheduledById: string | null
}

export interface WorkflowListFilter {
  status?: WorkflowStatus | 'ALL'
  type?: string
  scope?: 'running' | 'recent' | 'all'
  scheduledBy?: string
}

export interface WorkflowPageRequest {
  pageIndex: number
  pageSize: number
}

export interface WorkflowPageResult {
  items: WorkflowView[]
  hasMore: boolean
  /** Synthesized so DataTable manualPagination enables "next" iff another page exists. */
  total: number
  pageIndex: number
  pageSize: number
}

export interface WatchdogHealState {
  scheduleId: string
  unstucks: number
  injectedTriggers: number
  lastHealTriggerAt: string | null
  lastActionCount: number
  unhealthy: boolean
  observedUnhealthy: boolean
  recreations: number
  lastRecreatedAt: string | null
}

export type ScheduleHealthState = 'healthy' | 'paused' | 'stale' | 'unhealthy'

export type ScheduleFireView = {
  scheduledAt: string
  takenAt: string
  lagMs: number
  workflowId: string
  firstExecutionRunId: string | null
}

export interface ScheduleHealthRow {
  scheduleId: string
  state: ScheduleHealthState
  paused: boolean
  lastFire: string | null
  nextFire: string | null
  unstucks: number
  unhealthy: boolean
  observedUnhealthy: boolean
  note: string | null
  /** Most recent actions started, sorted oldest to newest (as the SDK returns them). */
  recentFires: ScheduleFireView[]
  recreations: number
  lastRecreatedAt: string | null
}

export function mapWorkflowInfoToView(
  info: WorkflowExecutionInfo,
  nowMs: number = Date.now(),
): WorkflowView {
  const startMs = info.startTime.getTime()
  const closeMs = info.closeTime ? info.closeTime.getTime() : null
  const scheduledByRaw = info.searchAttributes[TEMPORAL_SCHEDULED_BY_ID]?.[0]
  return {
    workflowId: info.workflowId,
    runId: info.runId,
    type: info.type,
    status: info.status.name,
    startTime: info.startTime.toISOString(),
    closeTime: info.closeTime ? info.closeTime.toISOString() : null,
    elapsedMs: (closeMs ?? nowMs) - startMs,
    scheduledById: typeof scheduledByRaw === 'string' ? scheduledByRaw : null,
  }
}

export function matchesWorkflowFilter(view: WorkflowView, filter: WorkflowListFilter): boolean {
  if (filter.status && filter.status !== 'ALL' && view.status !== filter.status) return false
  if (filter.scope === 'running' && view.status !== 'RUNNING') return false
  if (filter.type && view.type !== filter.type) return false
  if (filter.scheduledBy && !view.workflowId.startsWith(`${filter.scheduledBy}-workflow-`)) return false
  return true
}

// Temporal query uses PascalCase status names, distinct from the SDK's SCREAMING_SNAKE enum names.
const STATUS_QUERY_NAME: Record<WorkflowStatus, string> = {
  UNSPECIFIED: 'Unspecified',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Canceled',
  TERMINATED: 'Terminated',
  CONTINUED_AS_NEW: 'ContinuedAsNew',
  TIMED_OUT: 'TimedOut',
  UNKNOWN: 'Unknown',
}

export function buildWorkflowListQuery(filter: WorkflowListFilter): string | undefined {
  const clauses: string[] = []
  if (filter.status && filter.status !== 'ALL') {
    clauses.push(`ExecutionStatus = "${STATUS_QUERY_NAME[filter.status]}"`)
  } else if (filter.scope === 'running') {
    clauses.push('ExecutionStatus = "Running"')
  }
  if (filter.type) {
    // Single-quoted literal with '' escaping (same as scheduledBy below). filter.type
    // is operator free-text ("Other…"): an unescaped double-quoted value could break
    // or silently alter the visibility query (#138).
    clauses.push(`WorkflowType = '${filter.type.replace(/'/g, "''")}'`)
  }
  if (filter.scheduledBy) {
    clauses.push(`TemporalScheduledById = '${filter.scheduledBy.replace(/'/g, "''")}'`)
  }
  return clauses.length ? clauses.join(' AND ') : undefined
}

/**
 * On basic (standard) visibility, Temporal rejects advanced query strings with
 * INVALID_ARGUMENT. ONLY that error justifies the unfiltered client-side fallback;
 * any other rejection (transient RPC, auth) must propagate to the action's error
 * path instead of silently triggering a full-namespace scan (#602/M8).
 */
export function isBasicVisibilityQueryError(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: number }).code : undefined
  if (code === 3) return true // INVALID_ARGUMENT
  const msg = e instanceof Error ? e.message : String(e)
  return /invalid.*query|unsupported|not\s+support|advanced visibility|basic visibility/i.test(msg)
}

/** Hard cap on rows walked by the client-side fallback so a large history can't be scanned end-to-end on every poll. */
export const MAX_FALLBACK_SCAN = 5_000

/**
 * Bounded offset pagination over the decoded high-level `client.workflow.list()`
 * iterable. We deliberately use the decoded iterable (clean Date/status fields,
 * one testable mapper) rather than raw `nextPageToken` proto decoding: the
 * high-level iterable does not surface tokens, DataTable's manualPagination is
 * index-based (needs a page count), and operator workflow volumes are modest.
 * On an invalid-query rejection (basic visibility) we retry unfiltered +
 * client-filter, capped at MAX_FALLBACK_SCAN rows.
 */
export async function listWorkflowViews(
  client: Client,
  filter: WorkflowListFilter,
  page: WorkflowPageRequest,
  nowMs: number = Date.now(),
  logger?: { warn: (obj: unknown, msg: string) => void },
): Promise<WorkflowPageResult> {
  const { pageIndex, pageSize } = page
  const skip = pageIndex * pageSize
  const query = buildWorkflowListQuery(filter)

  async function collect(
    useServerQuery: boolean,
    applyClientFilter: boolean,
    maxScan?: number,
  ): Promise<{ views: WorkflowView[]; truncated: boolean }> {
    const out: WorkflowView[] = []
    let seen = 0
    let scanned = 0
    const iterable =
      useServerQuery && query ? client.workflow.list({ query }) : client.workflow.list()
    for await (const info of iterable) {
      scanned++
      const view = mapWorkflowInfoToView(info, nowMs)
      if (!applyClientFilter || matchesWorkflowFilter(view, filter)) {
        if (seen >= skip) out.push(view)
        seen++
        if (out.length > pageSize) break // one extra row signals hasMore
      }
      if (maxScan && scanned >= maxScan) {
        return { views: out, truncated: out.length <= pageSize }
      }
    }
    return { views: out, truncated: false }
  }

  let result: { views: WorkflowView[]; truncated: boolean }
  try {
    result = await collect(true, false)
  } catch (e) {
    if (!isBasicVisibilityQueryError(e)) throw e
    result = await collect(false, true, MAX_FALLBACK_SCAN)
    if (result.truncated) {
      logger?.warn(
        { pageIndex, pageSize, maxScan: MAX_FALLBACK_SCAN },
        'Basic-visibility fallback scan hit the row cap; result may be incomplete',
      )
    }
  }

  const collected = result.views
  const hasMore = collected.length > pageSize
  const items = collected.slice(0, pageSize)
  const total = pageIndex * pageSize + items.length + (hasMore ? pageSize : 0)
  return { items, hasMore, total, pageIndex, pageSize }
}

/** Watchdog liveness config defaults (mirror parseWatchdogConfig) for UI-side liveness. */
const UI_LIVENESS_CONFIG = { minAgeMs: 180_000, missedFirings: 5, minGraceMs: 90_000, graceCapMs: 600_000 }

/**
 * Authoritative liveness verdict for a schedule, computed with the SAME
 * `evaluateLiveness` the watchdog uses — so it honors the running-actions guard,
 * infancy grace, and skew guards, and never false-flags a schedule whose run is
 * still executing under SKIP overlap (M6, review-corrected). Needs a full
 * `ScheduleDescription` (schedule.list() summaries lack runningActions). Returns
 * 'unknown' for non-interval schedules (cron/calendar): a 0/absent interval makes
 * the grace band meaningless, so we defer to the counter-based signal there.
 */
export function scheduleLiveness(
  desc: ScheduleDescription,
  heal: WatchdogHealState | null,
  now: Date = new Date(),
): Verdict {
  const everyMs = desc.spec.intervals?.[0]?.every
  const intervalMs = typeof everyMs === 'number' ? everyMs : 0
  if (intervalMs <= 0) return 'unknown'
  const entry: WatchdogEntry = {
    scheduleId: desc.scheduleId,
    workflowType: '',
    taskQueue: '',
    args: [],
    interval: '',
    intervalMs,
    ...UI_LIVENESS_CONFIG,
  }
  // evaluateLiveness reads only lastActionCount + injectedTriggers off state.
  const state = {
    ...defaultHealState(desc.scheduleId),
    lastActionCount: heal?.lastActionCount ?? 0,
    injectedTriggers: heal?.injectedTriggers ?? 0,
  }
  return evaluateLiveness(desc, entry, now, state)
}

export function mapScheduleToHealth(
  summary: ScheduleSummary | ScheduleDescription,
  heal: WatchdogHealState | null,
  liveness?: Verdict,
): ScheduleHealthRow {
  // Schedule listing is eventual-consistent (SDK doc), so recentActions and the
  // last entry's takenAt can be absent — guard both, else one partial entry throws
  // and the whole GetScheduleHealth load fails for EVERY schedule (M4/#196).
  const recent = summary.info.recentActions ?? []
  const nextTimes = summary.info.nextActionTimes ?? []
  const lastFire = recent.at(-1)?.takenAt?.toISOString() ?? null
  const nextFire = nextTimes[0]?.toISOString() ?? null
  const paused = summary.state.paused

  // Union the watchdog's persisted heal signals (unhealthy/observedUnhealthy/
  // unstucks) with the live verdict (M6): `liveness` is computed by scheduleLiveness
  // via the running-actions-aware evaluateLiveness, so it catches a schedule that
  // stopped firing even when the watchdog is disabled/down/between ticks, WITHOUT
  // false-flagging one whose run is still in flight. Absent (summary-only callers)
  // it degrades to counter-only.
  let state: ScheduleHealthState
  if (paused) state = 'paused'
  else if (heal?.unhealthy || heal?.observedUnhealthy) state = 'unhealthy'
  else if (liveness === 'stale' || (heal && heal.unstucks > 0)) state = 'stale'
  else state = 'healthy'

  // Schedule listing is eventual-consistent (SDK doc comment on ScheduleSummary), so
  // guard against a stale/partial recentActions entry rather than trusting the types.
  const recentFires: ScheduleFireView[] = recent.flatMap((a) => {
    const workflowId = a.action?.workflow?.workflowId
    if (!workflowId || !a.scheduledAt || !a.takenAt) return []
    return [{
      scheduledAt: a.scheduledAt.toISOString(),
      takenAt: a.takenAt.toISOString(),
      lagMs: a.takenAt.getTime() - a.scheduledAt.getTime(),
      workflowId,
      firstExecutionRunId: a.action.workflow.firstExecutionRunId ?? null,
    }]
  })

  return {
    scheduleId: summary.scheduleId,
    state,
    paused,
    lastFire,
    nextFire,
    unstucks: heal?.unstucks ?? 0,
    unhealthy: heal?.unhealthy ?? false,
    observedUnhealthy: heal?.observedUnhealthy ?? false,
    note: summary.state.note ?? null,
    recentFires,
    recreations: heal?.recreations ?? 0,
    lastRecreatedAt: heal?.lastRecreatedAt ?? null,
  }
}
