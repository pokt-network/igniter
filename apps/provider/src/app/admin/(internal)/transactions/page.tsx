import type { Metadata } from 'next'
import React from 'react'
import { GetAppName } from '@/actions/ApplicationSettings'
import TransactionsTable from './table'
import MigrateHistoryButton from './MigrateHistoryButton'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return {
    title: `Transactions - ${appName}`,
  }
}

export default async function TransactionsPage() {
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Track all blockchain transactions for your supplier keys."
        actions={<MigrateHistoryButton />}
      />
      <PageContent>
        <TransactionsTable />
      </PageContent>
    </>
  )
}
