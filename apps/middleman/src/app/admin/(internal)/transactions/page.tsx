import type { Metadata } from 'next'
import TransactionsTable from '@/app/admin/(internal)/transactions/table'
import { GetAppName } from '@/actions/ApplicationSettings'

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
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Transactions</h1>
              <p className="text-text-secondary">
                Track all staking and unstaking transactions.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 pt-6">
        <TransactionsTable />
      </div>
    </>
  );
}
