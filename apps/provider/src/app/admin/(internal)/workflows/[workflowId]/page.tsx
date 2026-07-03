import { Suspense } from 'react'

import PageContent from '@igniter/ui/components/PageContent'

import { WorkflowDetailClient } from './WorkflowDetailClient'

export const dynamic = 'force-dynamic'

// App Router delivers dynamic-segment params still percent-encoded (observed live:
// colons arrive as %3A); decode defensively — tolerates an already-decoded value.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workflowId: string }>
  searchParams: Promise<{ runId?: string }>
}) {
  const { workflowId } = await params
  const { runId } = await searchParams
  return (
    <PageContent>
      <Suspense>
        <WorkflowDetailClient workflowId={safeDecode(workflowId)} runId={runId} />
      </Suspense>
    </PageContent>
  )
}
