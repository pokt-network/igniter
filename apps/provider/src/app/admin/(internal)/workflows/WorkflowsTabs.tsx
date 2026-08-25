'use client'

import { notify } from "@igniter/ui/lib/sessionMessages";
import { WorkflowsTabs as SharedWorkflowsTabs } from '@igniter/ui/components/workflows/WorkflowsTabs'
import * as Workflows from '@/actions/Workflows'
import { PROVIDER_WORKFLOW_TYPES } from './workflowTypes'

/**
 * Thin app wrapper: binds the provider's Temporal server actions + workflow
 * types to the shared workflows admin UI, and wires terminate errors to this
 * app's toast notifications. All UI lives in `@igniter/ui/components/workflows`.
 */
export function WorkflowsTabs() {
  return (
    <SharedWorkflowsTabs
      actions={Workflows}
      workflowTypes={PROVIDER_WORKFLOW_TYPES}
      tableFeedback={{
        mode: 'toast',
        onTerminateError: (message) =>
          notify.error('Failed to terminate workflow.', {
            id: 'terminate-workflow-error',
            description: message,
          }),
      }}
    />
  )
}
