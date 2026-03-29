import type { Metadata } from 'next'
import React from 'react'
import KeysTable from '@/app/admin/(internal)/keys/table'
import { GetAppName } from '@/actions/ApplicationSettings'
import ClearRemediationButton from '@/app/admin/(internal)/keys/ClearRemediationButton'
import AutoStakeToggle from '@/app/admin/(internal)/keys/AutoStakeToggle'
import RequestRemediationButton from '@/app/admin/(internal)/keys/RequestRemediationButton'
import KeyActions from '@/app/admin/(internal)/keys/KeyActions'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Keys - ${appName}`,
  }
}

export default async function AddressesPage() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Keys</h1>
              <p className="text-text-secondary">
                Manage your supplier keys, imports, and remediation.
              </p>
            </div>
            <div className="flex flex-row gap-3 items-center">
              <KeyActions />
              <RequestRemediationButton />
              <ClearRemediationButton />
              <div className="w-px h-6 bg-border-primary" />
              <AutoStakeToggle />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        <KeysTable />
      </div>
    </>
  )
}
