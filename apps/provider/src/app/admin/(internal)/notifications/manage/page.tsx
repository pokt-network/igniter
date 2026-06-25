import type { Metadata } from 'next'
import Link from 'next/link'
import { GetAppName } from '@/actions/ApplicationSettings'
import { NotificationChannelsSection } from '@/app/admin/(internal)/settings/notifications/NotificationChannelsSection'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { Button } from '@igniter/ui/components/button'
import { ArrowLeftIcon } from 'lucide-react'

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
        subtitle="Configure channels, SMTP, and event preferences."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/notifications">
              <ArrowLeftIcon className="h-3.5 w-3.5 mr-1" />
              Back to History
            </Link>
          </Button>
        }
      />
      <PageContent>
        <NotificationChannelsSection />
      </PageContent>
    </>
  )
}