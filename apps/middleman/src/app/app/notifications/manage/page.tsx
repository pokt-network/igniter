import type { Metadata } from 'next'
import React from 'react'
import Link from 'next/link'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { Button } from '@igniter/ui/components/button'
import { ArrowLeftIcon } from 'lucide-react'
import { GetAppName } from '@/actions/ApplicationSettings'
import { NotificationsManager } from '../NotificationsManager'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return {
    title: `Manage Notifications - ${appName}`,
  }
}

export default function ManageNotificationsPage() {
  return (
    <>
      <PageHeader
        title="Manage Notifications"
        subtitle="Configure where your supplier, transaction, and import updates are delivered."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/notifications">
              <ArrowLeftIcon className="h-3.5 w-3.5 mr-1" />
              Back to History
            </Link>
          </Button>
        }
      />
      <PageContent>
        <NotificationsManager />
      </PageContent>
    </>
  )
}
