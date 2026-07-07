import type { Metadata } from 'next'
import React from 'react'
import Link from 'next/link'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { Button } from '@igniter/ui/components/button'
import { Settings2Icon } from 'lucide-react'
import { GetAppName } from '@/actions/ApplicationSettings'
import { NotificationHistorySection } from './NotificationHistorySection'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return {
    title: `Notifications - ${appName}`,
  }
}

export default async function Page() {
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="History of your supplier, transaction, and import updates."
        actions={
          <Button variant="default" size="sm" asChild>
            <Link href="/app/notifications/manage">
              <Settings2Icon className="h-3.5 w-3.5 mr-1.5" />
              Manage Notifications
            </Link>
          </Button>
        }
      />
      <PageContent>
        <NotificationHistorySection />
      </PageContent>
    </>
  )
}
