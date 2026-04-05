import type { Metadata } from 'next'
import TransactionsTable from '@/app/admin/(internal)/transactions/table'
import { GetAppName } from '@/actions/ApplicationSettings'
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
        subtitle="Track all staking and unstaking transactions."
      />
      <PageContent>
        <TransactionsTable />
      </PageContent>
    </>
  );
}
