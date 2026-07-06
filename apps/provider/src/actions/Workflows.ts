'use server'

import { type ActionResult, withRequireOwner } from '@/lib/utils/actionUtils'
import { getTemporalClient } from '@/lib/temporal'
import { listWatchdogHealState } from '@/lib/dal/watchdogHealState'
import {
  listWorkflowViews,
  mapScheduleToHealth,
  scheduleLiveness,
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
