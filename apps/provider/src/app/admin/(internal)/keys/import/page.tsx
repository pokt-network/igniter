import type { Metadata } from 'next'
import { ListAddressGroups } from '@/actions/AddressGroups'
import ImportForm from '@/app/admin/(internal)/keys/import/ImportForm'
import { GetAppName } from '@/actions/ApplicationSettings'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Import Keys - ${appName}`,
    description: "Light up your earnings with Igniter",
  }
}

export default async function ImportPage() {
  const result = await ListAddressGroups()

  if (!result.success) {
    throw new Error(result.error.message);
  }

  return (
    <ImportForm addressesGroup={result.data} />
  )
}
