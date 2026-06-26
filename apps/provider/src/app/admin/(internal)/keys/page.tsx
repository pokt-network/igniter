import type { Metadata } from 'next'
import React from 'react'
import KeysTable from '@/app/admin/(internal)/keys/table'
import ActivitiesSection from '@/app/admin/(internal)/keys/ActivitiesSection'
import { GetAppName, GetApplicationSettings } from '@/actions/ApplicationSettings'
import ClearRemediationButton from '@/app/admin/(internal)/keys/ClearRemediationButton'
import AutoStakeToggle from '@/app/admin/(internal)/keys/AutoStakeToggle'
import RequestRemediationButton from '@/app/admin/(internal)/keys/RequestRemediationButton'
import KeyActions from '@/app/admin/(internal)/keys/KeyActions'
import { KeysSelectionProvider } from '@/app/admin/(internal)/keys/KeysSelectionContext'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Keys - ${appName}`,
  }
}

export default async function AddressesPage() {
  const settings = await GetApplicationSettings()
  const returnFundsDefault = settings?.returnSupplierFundsToOwner ?? false

  return (
    <KeysSelectionProvider>
      <PageHeader
        title="Keys"
        subtitle="Manage your supplier keys, imports, and remediation."
        actions={
          <>
            <KeyActions returnFundsDefault={returnFundsDefault} />
            <RequestRemediationButton />
            <ClearRemediationButton />
            <div className="w-px h-6 bg-border-primary" />
            <AutoStakeToggle />
          </>
        }
      />
      <PageContent>
        <ActivitiesSection />
        <React.Suspense>
          <KeysTable />
        </React.Suspense>
      </PageContent>
    </KeysSelectionProvider>
  )
}
