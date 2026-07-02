import type {
  Client,
  WorkflowExecutionInfo,
  WorkflowExecutionStatusName,
  ScheduleSummary,
} from '@temporalio/client'

// Type-only import from workflowDetail is erased at runtime (no require-cycle);
// the value import below is what actually loads the module.
import { TEMPORAL_SCHEDULED_BY_ID } from '@/workflowDetail'

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
  attempts: number
  injectedTriggers: number
  lastHealTriggerAt: string | null
  lastActionCount: number
  unhealthy: boolean
  observedUnhealthy: boolean
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
  attempts: number
  unhealthy: boolean
  observedUnhealthy: boolean
  note: string | null
  /** Most recent actions started, sorted oldest to newest (as the SDK returns them). */
  recentFires: ScheduleFireView[]
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
    clauses.push(`WorkflowType = "${filter.type}"`)
  }
  if (filter.scheduledBy) {
    clauses.push(`TemporalScheduledById = '${filter.scheduledBy.replace(/'/g, "''")}'`)
  }
  return clauses.length ? clauses.join(' AND ') : undefined
}

/**
 * Bounded offset pagination over the decoded high-level `client.workflow.list()`
 * iterable. We deliberately use the decoded iterable (clean Date/status fields,
 * one testable mapper) rather than raw `nextPageToken` proto decoding: the
 * high-level iterable does not surface tokens, DataTable's manualPagination is
 * index-based (needs a page count), and operator workflow volumes are modest.
 * On a query rejection (basic visibility) we retry unfiltered + client-filter.
 */
export async function listWorkflowViews(
  client: Client,
  filter: WorkflowListFilter,
  page: WorkflowPageRequest,
  nowMs: number = Date.now(),
): Promise<WorkflowPageResult> {
  const { pageIndex, pageSize } = page
  const skip = pageIndex * pageSize
  const query = buildWorkflowListQuery(filter)

  async function collect(useServerQuery: boolean, applyClientFilter: boolean): Promise<WorkflowView[]> {
    const out: WorkflowView[] = []
    let seen = 0
    const iterable =
      useServerQuery && query ? client.workflow.list({ query }) : client.workflow.list()
    for await (const info of iterable) {
      const view = mapWorkflowInfoToView(info, nowMs)
      if (applyClientFilter && !matchesWorkflowFilter(view, filter)) continue
      if (seen >= skip) out.push(view)
      seen++
      if (out.length > pageSize) break // one extra row signals hasMore
    }
    return out
  }

  let collected: WorkflowView[]
  try {
    collected = await collect(true, false)
  } catch {
    collected = await collect(false, true)
  }

  const hasMore = collected.length > pageSize
  const items = collected.slice(0, pageSize)
  const total = pageIndex * pageSize + items.length + (hasMore ? pageSize : 0)
  return { items, hasMore, total, pageIndex, pageSize }
}

export function mapScheduleToHealth(
  summary: ScheduleSummary,
  heal: WatchdogHealState | null,
): ScheduleHealthRow {
  const recent = summary.info.recentActions
  const lastFire = recent.at(-1)?.takenAt.toISOString() ?? null
  const nextFire = summary.info.nextActionTimes[0]?.toISOString() ?? null
  const paused = summary.state.paused

  let state: ScheduleHealthState
  if (paused) state = 'paused'
  else if (heal?.unhealthy || heal?.observedUnhealthy) state = 'unhealthy'
  else if (heal && heal.attempts > 0) state = 'stale'
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
    attempts: heal?.attempts ?? 0,
    unhealthy: heal?.unhealthy ?? false,
    observedUnhealthy: heal?.observedUnhealthy ?? false,
    note: summary.state.note ?? null,
    recentFires,
  }
}
