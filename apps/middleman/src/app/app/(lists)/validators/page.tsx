import type { Metadata } from 'next'
import React from 'react'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { GetAppName } from '@/actions/ApplicationSettings'
import MyDelegations from './MyDelegations'
import ValidatorsTable from './ValidatorsTable'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return { title: `Validators - ${appName}` }
}

export default async function Page() {
  return (
    <>
      <PageHeader
        title="Validators"
        subtitle="Delegate POKT to validators and track your delegations and rewards."
      />
      <PageContent>
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">My Delegations</h2>
          <MyDelegations />
        </section>
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Validators</h2>
          <ValidatorsTable />
        </section>
      </PageContent>
    </>
  )
}
