'use client'

import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { WorkflowsTabs as SharedWorkflowsTabs } from '@igniter/ui/components/workflows/WorkflowsTabs'
import * as Workflows from '@/actions/Workflows'
import { PROVIDER_WORKFLOW_TYPES } from './workflowTypes'

/**
 * Thin app wrapper: binds the provider's Temporal server actions + workflow
 * types to the shared workflows admin UI, and wires terminate errors to this
 * app's toast notifications. All UI lives in `@igniter/ui/components/workflows`.
 */
export function WorkflowsTabs() {
  const { addNotification } = useNotifications()
  return (
    <SharedWorkflowsTabs
      actions={Workflows}
      workflowTypes={PROVIDER_WORKFLOW_TYPES}
      tableFeedback={{
        mode: 'toast',
        onTerminateError: (message) =>
          addNotification({
            id: 'terminate-workflow-error',
            type: 'error',
            showTypeIcon: true,
            content: message,
          }),
      }}
    />
  )
}
