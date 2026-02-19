import ClientImportSuppliersPage from '@/app/app/import-suppliers/clientPage'
import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Import Suppliers - ${appName}`,
  }
}

export default function ImportSuppliersPage() {
  return <ClientImportSuppliersPage />
}
