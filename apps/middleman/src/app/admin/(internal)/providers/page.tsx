import type { Metadata } from 'next'
import React from 'react'
import ProvidersTable from "@/app/admin/(internal)/providers/table";
import { GetAppName } from '@/actions/ApplicationSettings'
import RefreshProviders from '@/app/admin/(internal)/providers/Refresh'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Providers - ${appName}`,
  }
}

export default function ProvidersPage() {
  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Manage the providers delegating through your gateway."
        actions={<RefreshProviders />}
      />
      <PageContent>
        <ProvidersTable />
      </PageContent>
    </>
  )
}
