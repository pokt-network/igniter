'use client'

import { useNotifications } from '@igniter/ui/context/Notifications/index'
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
  const { addNotification } = useNotifications()
  return (
    <SharedWorkflowDetailClient
      workflowId={workflowId}
      runId={runId}
      actions={Workflows}
      feedback={{
        mode: 'toast',
        onTerminateError: (message) =>
          addNotification({ id: 'terminate-workflow-error', type: 'error', content: message }),
        onDownloadError: (message) =>
          addNotification({ id: 'history-download-error', type: 'error', content: message }),
      }}
    />
  )
}
