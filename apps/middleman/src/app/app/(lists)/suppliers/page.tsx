import type { Metadata } from 'next'
import React, { Suspense } from 'react'
import ProviderStats from '@/app/app/(lists)/suppliers/ProviderStats'
import RecentChanges from '@/app/app/(lists)/suppliers/RecentChanges'
import SuppliersTabs from '@/app/app/(lists)/suppliers/SuppliersTabs'
import { GetAppName } from '@/actions/ApplicationSettings'
import Link from 'next/link'
import { Button } from '@igniter/ui/components/button'
import { UnstakeButton } from '@/app/app/(lists)/suppliers/UnstakeButton'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Suppliers - ${appName}`,
  }
}

export default async function Page() {
  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Manage your suppliers and their stake configurations."
        actions={
          <>
            <Link href="/app/stake">
              <Button>New Stake</Button>
            </Link>
            <Link href="/app/import-suppliers">
              <Button className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90">Import Suppliers</Button>
            </Link>
            <UnstakeButton />
          </>
        }
      />
      <PageContent>
        <ProviderStats />
        <Suspense>
          <RecentChanges />
        </Suspense>
        <Suspense>
          <SuppliersTabs />
        </Suspense>
      </PageContent>
    </>
  );
}
