import type { Metadata } from 'next'
import TransactionsTable from '@/app/app/(lists)/transactions/table'
import { GetAppName } from '@/actions/ApplicationSettings'
import React from 'react'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Transactions - ${appName}`,
  }
}

export default async function Page() {
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Track all your staking and unstaking transactions."
      />
      <PageContent>
        <TransactionsTable />
      </PageContent>
    </>
  );
}
