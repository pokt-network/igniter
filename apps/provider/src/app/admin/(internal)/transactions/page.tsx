import type { Metadata } from 'next'
import React from 'react'
import { GetAppName } from '@/actions/ApplicationSettings'
import TransactionsTable from './table'
import MigrateHistoryButton from './MigrateHistoryButton'

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
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Transactions</h1>
              <p className="text-text-secondary">
                Track all blockchain transactions for your supplier keys.
              </p>
            </div>
            <div className="flex flex-row gap-3 items-center">
              <MigrateHistoryButton />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        <TransactionsTable />
      </div>
    </>
  )
}
