import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import WorkflowsTable from './table'
import ScheduleHealthPanel from './ScheduleHealthPanel'

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
        <ScheduleHealthPanel />
        <WorkflowsTable />
      </PageContent>
    </>
  )
}
