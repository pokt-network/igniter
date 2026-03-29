import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import { ListAddressGroups } from '@/actions/AddressGroups'
import GenerateForm from './GenerateForm'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Generate Keys - ${appName}`,
    description: "Generate new keys for an address group",
  }
}

export default async function GeneratePage() {
  const result = await ListAddressGroups()

  if (!result.success) {
    throw new Error(result.error.message)
  }

  return (
    <GenerateForm addressesGroup={result.data} />
  )
}
