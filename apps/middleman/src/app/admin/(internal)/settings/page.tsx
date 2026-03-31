import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import SettingsForm from '@/app/admin/(internal)/settings/Form'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Settings - ${appName}`,
  }
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Configure your gateway and blockchain connection."
      />
      <PageContent>
        <SettingsForm />
      </PageContent>
    </>
  );
}
