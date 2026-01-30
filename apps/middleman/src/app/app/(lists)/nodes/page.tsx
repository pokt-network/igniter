import type { Metadata } from 'next'
import React from 'react'
import NodesTable from '@/app/app/(lists)/nodes/table'
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
            </div>
            <div className="flex flex-col">
              <div className="flex flex-row gap-3">
                <Link href="/app/stake">
                  <Button>New Stake</Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-10 pt-10">
        <NodesTable />
      </div>
    </>
  );
}
