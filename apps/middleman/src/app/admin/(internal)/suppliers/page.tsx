import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import SuppliersTable from './table'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Suppliers - ${appName}`,
  }
}

export default function SuppliersPage() {
  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="All suppliers across all providers."
      />
      <PageContent>
        <SuppliersTable />
      </PageContent>
    </>
  )
}
