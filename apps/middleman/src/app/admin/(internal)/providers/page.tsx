import type { Metadata } from 'next'
import React from 'react'
import ProvidersTable from "@/app/admin/(internal)/providers/table";
import { GetAppName } from '@/actions/ApplicationSettings'
import RefreshProviders from '@/app/admin/(internal)/providers/Refresh'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Providers - ${appName}`,
  }
}

export default function ProvidersPage() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Providers</h1>
              <p className="text-text-secondary">
                Manage the providers delegating through your gateway.
              </p>
            </div>
            <div className="flex flex-row gap-3">
              <RefreshProviders />
            </div>
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 pt-6">
        <ProvidersTable />
      </div>
    </>
  )
}
