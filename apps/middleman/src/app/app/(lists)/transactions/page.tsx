import type { Metadata } from 'next'
import TransactionsTable from '@/app/app/(lists)/transactions/table'
import { GetAppName } from '@/actions/ApplicationSettings'
import React from 'react'

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
      <div className={"border-b-1"}>
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-10">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Transactions</h1>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-10 pt-10">
        <TransactionsTable />
      </div>
    </>
  );
}
