'use client'

import { notify } from "@igniter/ui/lib/sessionMessages";
import { WorkflowDetailClient as SharedWorkflowDetailClient } from '@igniter/ui/components/workflows/WorkflowDetailClient'
import * as Workflows from '@/actions/Workflows'

/**
 * Thin app wrapper: binds the provider's Temporal server actions to the shared
 * workflow detail UI and wires terminate/download errors to this app's toast
 * notifications. All UI lives in `@igniter/ui/components/workflows`.
 */
export function WorkflowDetailClient({
  workflowId,
  runId,
}: {
  workflowId: string
  runId?: string
}) {
  return (
    <SharedWorkflowDetailClient
      workflowId={workflowId}
      runId={runId}
      actions={Workflows}
      feedback={{
        mode: 'toast',
        onTerminateError: (message) =>
          notify.error('Failed to terminate workflow.', {
            id: 'terminate-workflow-error',
            description: message,
          }),
        onDownloadError: (message) =>
          notify.error('Failed to download workflow history.', {
            id: 'history-download-error',
            description: message,
          }),
      }}
    />
  )
}
