import type { ActionResult } from '../../lib/actionResult'
import type {
  WorkflowListFilter,
  WorkflowPageRequest,
  WorkflowPageResult,
  ScheduleHealthRow,
} from '@igniter/temporal/workflow-view'
import type { WorkflowDetailView } from '@igniter/temporal/workflow-detail'

/**
 * The Temporal `Workflows` server actions each app binds to its own db/temporal
 * client. The shared workflows admin UI receives this object as a prop (server
 * actions cannot live in a shared client component), so both apps drive the
 * exact same UI while keeping their own auth + wiring.
 */
export interface WorkflowsActions {
  ListWorkflows: (
    filter: WorkflowListFilter,
    page: WorkflowPageRequest,
  ) => Promise<ActionResult<WorkflowPageResult>>
  GetScheduleHealth: () => Promise<ActionResult<ScheduleHealthRow[]>>
  TerminateWorkflow: (workflowId: string, runId?: string) => Promise<ActionResult<void>>
  GetWorkflowDetail: (workflowId: string, runId?: string) => Promise<ActionResult<WorkflowDetailView>>
  GetWorkflowHistoryJson: (workflowId: string, runId?: string) => Promise<ActionResult<string>>

  /**
   * Optional schedule controls. Buttons render only when the app injects them,
   * so an app build that predates these actions keeps a read-only tab.
   */
  PauseSchedule?: (scheduleId: string, note?: string) => Promise<ActionResult<void>>
  ResumeSchedule?: (scheduleId: string) => Promise<ActionResult<void>>
  RecreateSchedule?: (scheduleId: string) => Promise<ActionResult<void>>
}

/**
 * How the workflows table surfaces a failed Terminate.
 *
 * - `toast`: the app shows a notification and the confirm dialog closes (the
 *   provider app's behavior — it wires `useNotifications`).
 * - `inline`: the shared component renders an inline error inside the dialog and
 *   keeps it open (the middleman app's behavior).
 *
 * This single seam preserves each app's exact terminate UX without duplicating
 * the surrounding table.
 */
export type WorkflowsTableFeedback =
  | { mode: 'toast'; onTerminateError: (message: string) => void }
  | { mode: 'inline' }

/**
 * How the workflow detail view surfaces a failed Terminate / history download.
 * Same rationale as {@link WorkflowsTableFeedback}; the detail view has a second
 * (download) error site, hence the extra callback in `toast` mode.
 */
export type WorkflowDetailFeedback =
  | {
      mode: 'toast'
      onTerminateError: (message: string) => void
      onDownloadError: (message: string) => void
    }
  | { mode: 'inline' }
