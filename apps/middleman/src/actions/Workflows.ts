'use server'

import { requireAdmin } from '@/lib/utils/actions'
import { listWatchdogHealState } from '@/lib/dal/watchdogHealState'
import {
  listWorkflowViews,
  mapScheduleToHealth,
  type WorkflowListFilter,
  type WorkflowPageRequest,
  type WorkflowPageResult,
  type ScheduleHealthRow,
  type WatchdogHealState,
} from '@igniter/temporal/workflow-view'
import type { WorkflowDetailView } from '@igniter/temporal/workflow-detail'

export async function ListWorkflows(
  filter: WorkflowListFilter,
  page: WorkflowPageRequest,
): Promise<{ success: boolean; error?: string; data?: WorkflowPageResult }> {
  try {
    await requireAdmin()
    const { getTemporalClient } = await import('@/lib/temporal')
    const client = getTemporalClient()
    const data = await listWorkflowViews(client, filter, page)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
  }
}

export async function GetScheduleHealth(): Promise<{
  success: boolean
  error?: string
  data?: ScheduleHealthRow[]
}> {
  try {
    await requireAdmin()
    const { getTemporalClient } = await import('@/lib/temporal')
    const client = getTemporalClient()
    const healRows = await listWatchdogHealState()
    const healById = new Map<string, WatchdogHealState>(healRows.map((r) => [r.scheduleId, r]))
    const out: ScheduleHealthRow[] = []
    for await (const summary of client.schedule.list()) {
      out.push(mapScheduleToHealth(summary, healById.get(summary.scheduleId) ?? null))
    }
    return { success: true, data: out }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
  }
}

export async function TerminateWorkflow(
  workflowId: string,
  runId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin()
    const { getTemporalClient } = await import('@/lib/temporal')
    const client = getTemporalClient()
    const handle = client.workflow.getHandle(workflowId, runId)
    await handle.terminate('Terminated by operator from admin UI')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
  }
}

export async function GetWorkflowDetail(
  workflowId: string,
  runId?: string,
): Promise<{ success: boolean; error?: string; data?: WorkflowDetailView }> {
  try {
    await requireAdmin()
    const { getTemporalClient } = await import('@/lib/temporal')
    const { getWorkflowDetail } = await import('@igniter/temporal/workflow-detail')
    const client = getTemporalClient()
    const data = await getWorkflowDetail(client, workflowId, runId)
    return { success: true, data }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load workflow detail',
    }
  }
}

export async function GetWorkflowHistoryJson(
  workflowId: string,
  runId?: string,
): Promise<{ success: boolean; error?: string; data?: string }> {
  try {
    await requireAdmin()
    const { getTemporalClient } = await import('@/lib/temporal')
    const { getWorkflowHistoryJson } = await import('@igniter/temporal/workflow-detail')
    const client = getTemporalClient()
    const data = await getWorkflowHistoryJson(client, workflowId, runId)
    return { success: true, data }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to export history',
    }
  }
}
