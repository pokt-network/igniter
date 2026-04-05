import type { Metadata } from 'next'
import React from 'react'
import DelegatorsTable from "@/app/admin/(internal)/delegators/table";
import { GetAppName } from '@/actions/ApplicationSettings'
import RefreshDelegators from '@/app/admin/(internal)/delegators/Refresh'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Delegators - ${appName}`,
  }
}

export default function DelegatorsPage() {
  return (
    <>
      <PageHeader
        title="Delegators"
        subtitle="View and manage delegators using your provider."
        actions={<RefreshDelegators />}
      />
      <PageContent>
        <DelegatorsTable />
      </PageContent>
    </>
  )
}
