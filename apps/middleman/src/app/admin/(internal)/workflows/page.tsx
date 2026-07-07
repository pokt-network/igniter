import type { Metadata } from 'next'
import { Suspense } from 'react'
import { GetAppName } from '@/actions/ApplicationSettings'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { WorkflowsTabs } from './WorkflowsTabs'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return {
    title: `Workflows - ${appName}`,
  }
}

export default function WorkflowsPage() {
  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="Inspect running and recent Temporal workflows and schedule health."
      />
      <PageContent>
        <Suspense>
          <WorkflowsTabs />
        </Suspense>
      </PageContent>
    </>
  )
}
