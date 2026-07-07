'use client'

import { WorkflowDetailClient as SharedWorkflowDetailClient } from '@igniter/ui/components/workflows/WorkflowDetailClient'
import * as Workflows from '@/actions/Workflows'

/**
 * Thin app wrapper: binds the middleman's Temporal server actions to the shared
 * workflow detail UI. This app surfaces terminate/download errors inline. All
 * UI lives in `@igniter/ui/components/workflows`.
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
      feedback={{ mode: 'inline' }}
    />
  )
}
