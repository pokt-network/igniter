'use server'

import { type ActionResult, withRequireOwner } from '@/lib/utils/actionUtils'
import { getTemporalClient } from '@/lib/temporal'
import { listWatchdogHealState, resetWatchdogRecreations } from '@/lib/dal/watchdogHealState'
import {
  listWorkflowViews,
  mapScheduleToHealth,
  scheduleLiveness,
  isCorruptSchedule,
  isNotFound,
  type WorkflowListFilter,
  type WorkflowPageRequest,
  type WorkflowPageResult,
  type ScheduleHealthRow,
  type WatchdogHealState,
} from '@igniter/temporal/workflow-view'
import {
  getWorkflowDetail,
  getWorkflowHistoryJson,
  type WorkflowDetailView,
} from '@igniter/temporal/workflow-detail'

export async function ListWorkflows(
  filter: WorkflowListFilter,
  page: WorkflowPageRequest,
): Promise<ActionResult<WorkflowPageResult>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    return listWorkflowViews(client, filter, page)
  })
}

export async function GetScheduleHealth(): Promise<ActionResult<ScheduleHealthRow[]>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const healRows = await listWatchdogHealState()
    const healById = new Map<string, WatchdogHealState>(healRows.map((r) => [r.scheduleId, r]))
    const out: ScheduleHealthRow[] = []
    for await (const summary of client.schedule.list()) {
      const heal = healById.get(summary.scheduleId) ?? null
      try {
        // describe() (not the list summary) carries runningActions/createdAt/
        // numActionsTaken, which scheduleLiveness needs to judge staleness without
        // false-flagging an in-flight SKIP-overlap run (M6).
        const desc = await client.schedule.getHandle(summary.scheduleId).describe()
        out.push(mapScheduleToHealth(desc, heal, scheduleLiveness(desc, heal)))
      } catch {
        // One schedule failing (e.g. deleted between list() and describe()) must not
        // fail the whole panel — degrade this row to the summary + counter liveness (N2).
        out.push(mapScheduleToHealth(summary, heal))
      }
    }
    return out
  })
}

export async function TerminateWorkflow(
  workflowId: string,
  runId?: string,
): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const handle = client.workflow.getHandle(workflowId, runId)
    await handle.terminate('Terminated by operator from admin UI')
  })
}

export async function GetWorkflowDetail(
  workflowId: string,
  runId?: string,
): Promise<ActionResult<WorkflowDetailView>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    return getWorkflowDetail(client, workflowId, runId)
  })
}

export async function GetWorkflowHistoryJson(
  workflowId: string,
  runId?: string,
): Promise<ActionResult<string>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    return getWorkflowHistoryJson(client, workflowId, runId)
  })
}

/** Corrupt scheduler workflows reject pause/unpause; point the operator to the action that works. */
function rethrowWithRecreateHint(e: unknown, verb: 'paused' | 'resumed'): never {
  if (isCorruptSchedule(e)) {
    throw new Error(`Schedule internals are corrupt and cannot be ${verb}; use Recreate instead`)
  }
  throw e
}

export async function PauseSchedule(
  scheduleId: string,
  note?: string,
): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    try {
      await client.schedule.getHandle(scheduleId).pause(note ?? 'Paused by operator from admin UI')
    } catch (e) {
      // pause() is a query/patch on the scheduler workflow — impossible when it
      // is corrupt (WFT in failed state). Point the operator to the action that
      // does work in that state.
      rethrowWithRecreateHint(e, 'paused')
    }
  })
}

export async function ResumeSchedule(scheduleId: string): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    try {
      await client.schedule.getHandle(scheduleId).unpause('Resumed by operator from admin UI')
    } catch (e) {
      rethrowWithRecreateHint(e, 'resumed')
    }
  })
}

/**
 * "Recreate" is delete-only on purpose: canonical schedule config lives in the
 * workflows worker (bootstrap + watchdog entries), which recreates a missing
 * schedule with fresh heal counters within one watchdog tick (~30s).
 *
 * Reset the recreate breaker FIRST: manual Recreate is the documented operator
 * reset for a tripped breaker. Without it, delete → the watchdog's next tick sees
 * NOT_FOUND → the still-tripped breaker gates the recreate → the schedule stays
 * deleted forever (H1). Reset-before-delete is the correct order since the reset
 * only zeroes counters; the delete is what the watchdog reacts to.
 */
export async function RecreateSchedule(scheduleId: string): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    await resetWatchdogRecreations(scheduleId)
    try {
      await client.schedule.getHandle(scheduleId).delete()
    } catch (e) {
      if (isNotFound(e)) return // already gone — the watchdog is recreating it
      throw e
    }
  })
}
