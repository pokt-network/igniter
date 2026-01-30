import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import ClientProvidersPage from '@/app/app/providers/clientPage'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Providers - ${appName}`,
  }
}

export default function ProvidersPage() {
  return (
    <ClientProvidersPage />
  )
}
