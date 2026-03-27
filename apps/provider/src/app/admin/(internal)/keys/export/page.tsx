import type { Metadata } from 'next'
import { ListAddressGroups } from '@/actions/AddressGroups'
import { ListDelegators } from '@/actions/Delegators'
import { ListDistinctOwnerAddresses } from '@/actions/Keys'
import ExportForm from '@/app/admin/(internal)/keys/export/ExportForm'
import { GetAppName } from '@/actions/ApplicationSettings'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Export Keys - ${appName}`,
    description: "Light up your earnings with Igniter",
  }
}

export default async function ExportPage() {
  const [addressGroupsResult, delegatorsResult, ownersResult] = await Promise.all([
    ListAddressGroups(),
    ListDelegators(),
    ListDistinctOwnerAddresses(),
  ])

  if (!addressGroupsResult.success) {
    throw new Error(addressGroupsResult.error.message);
  }
  if (!delegatorsResult.success) {
    throw new Error(delegatorsResult.error.message);
  }
  if (!ownersResult.success) {
    throw new Error(ownersResult.error.message);
  }

  return (
    <ExportForm
      addressesGroup={addressGroupsResult.data}
      delegators={delegatorsResult.data}
      ownerAddresses={ownersResult.data}
    />
  )
}
