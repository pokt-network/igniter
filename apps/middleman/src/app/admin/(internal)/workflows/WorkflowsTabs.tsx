'use client'

import { WorkflowsTabs as SharedWorkflowsTabs } from '@igniter/ui/components/workflows/WorkflowsTabs'
import * as Workflows from '@/actions/Workflows'
import { MIDDLEMAN_WORKFLOW_TYPES } from './workflowTypes'

/**
 * Thin app wrapper: binds the middleman's Temporal server actions + workflow
 * types to the shared workflows admin UI. This app surfaces terminate errors
 * inline. All UI lives in `@igniter/ui/components/workflows`.
 */
export function WorkflowsTabs() {
  return (
    <SharedWorkflowsTabs
      actions={Workflows}
      workflowTypes={MIDDLEMAN_WORKFLOW_TYPES}
      tableFeedback={{ mode: 'inline' }}
    />
  )
}
