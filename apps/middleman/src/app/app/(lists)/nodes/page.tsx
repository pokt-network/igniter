import type { Metadata } from 'next'
import React from 'react'
import NodesTable from '@/app/app/(lists)/nodes/table'
import ProviderStats from '@/app/app/(lists)/nodes/ProviderStats'
import ChainOverview from '@/app/app/(lists)/nodes/ChainOverview'
import { GetAppName } from '@/actions/ApplicationSettings'
import Link from 'next/link'
import { Button } from '@igniter/ui/components/button'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Nodes - ${appName}`,
  }
}

export default async function Page() {
  return (
    <>
      <div className={"border-b-1"}>
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-10">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Suppliers</h1>
              <p className="text-muted-foreground">
                Manage your suppliers and their stake configurations. View active suppliers, their services, and
                performance metrics.
              </p>
            </div>
            <div className="flex flex-col">
              <div className="flex flex-row gap-3">
                <Link href="/app/unstake">
                  <Button variant="outline" className={'border-red-800/45'}>Unstake</Button>
                </Link>
                <Link href="/app/import-suppliers">
                  <Button variant="outline">Import Suppliers</Button>
                </Link>
                <Link href="/app/stake">
                  <Button>New Stake</Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-10 pt-10 flex flex-col gap-8">
        <ProviderStats />
        <ChainOverview />
        <NodesTable />
      </div>
    </>
  );
}
