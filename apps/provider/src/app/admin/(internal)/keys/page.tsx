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
    <div className="flex flex-col gap-10">
      <div className="mx-30 pt-10">
        <div className={'flex flex-row items-center gap-4'}>
          <h1>Keys</h1>
          <Link href={'/admin/keys/import'}>
            <Button className={'h-8 w-20'} variant={'outline'}>
              Import
            </Button>
          </Link>
          <Link href={'/admin/keys/export'}>
            <Button className={'h-8 w-20'} variant={'outline'}>
              Export
            </Button>
          </Link>
          <ClearRemediationButton />
          <RequestRemediationButton />
          <AutoStakeToggle />
        </div>
        <KeysTable />
      </div>
    </div>
  )
}
