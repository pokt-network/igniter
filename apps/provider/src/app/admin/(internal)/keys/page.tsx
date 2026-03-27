import type { Metadata } from 'next'
import React from 'react'
import KeysTable from '@/app/admin/(internal)/keys/table'
import { Button } from '@igniter/ui/components/button'
import Link from 'next/link'
import { GetAppName } from '@/actions/ApplicationSettings'
import ClearRemediationButton from '@/app/admin/(internal)/keys/ClearRemediationButton'
import AutoStakeToggle from '@/app/admin/(internal)/keys/AutoStakeToggle'
import RequestRemediationButton from '@/app/admin/(internal)/keys/RequestRemediationButton'

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
              <Link href={'/admin/keys/import'}>
                <Button>Import</Button>
              </Link>
              <Link href={'/admin/keys/export'}>
                <Button className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90">Export</Button>
              </Link>
              <Link href={'/admin/keys/generate'}>
                <Button className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90">Generate</Button>
              </Link>
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
