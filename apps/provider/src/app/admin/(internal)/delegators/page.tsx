import type { Metadata } from 'next'
import React from 'react'
import DelegatorsTable from "@/app/admin/(internal)/delegators/table";
import { GetAppName } from '@/actions/ApplicationSettings'
import RefreshDelegators from '@/app/admin/(internal)/delegators/Refresh'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Delegators - ${appName}`,
  }
}

export default function DelegatorsPage() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Delegators</h1>
              <p className="text-text-secondary">
                View and manage delegators using your provider.
              </p>
            </div>
            <div className="flex flex-row gap-3 items-center">
              <RefreshDelegators />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        <DelegatorsTable />
      </div>
    </>
  )
}
