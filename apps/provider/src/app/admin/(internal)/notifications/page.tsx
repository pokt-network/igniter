import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { GetAppName } from '@/actions/ApplicationSettings'
import { NotificationEventsSection } from './NotificationEventsSection'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { Button } from '@igniter/ui/components/button'
import { Settings2Icon } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return {
    title: `Notifications - ${appName}`,
  }
}

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="History of all notifications sent by your workflows."
        actions={
          <Button variant="default" size="sm" asChild>
            <Link href="/admin/notifications/manage">
              <Settings2Icon className="h-3.5 w-3.5 mr-1.5" />
              Manage Notifications
            </Link>
          </Button>
        }
      />
      <PageContent>
        <Suspense>
          <NotificationEventsSection />
        </Suspense>
      </PageContent>
    </>
  )
}