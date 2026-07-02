import { Suspense } from 'react'

import { WorkflowDetailClient } from './WorkflowDetailClient'

export const dynamic = 'force-dynamic'

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workflowId: string }>
  searchParams: Promise<{ runId?: string }>
}) {
  const { workflowId } = await params // already percent-decoded by Next — do NOT decode again
  const { runId } = await searchParams
  return (
    <Suspense>
      <WorkflowDetailClient workflowId={workflowId} runId={runId} />
    </Suspense>
  )
}
