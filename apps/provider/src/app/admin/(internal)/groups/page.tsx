import type { Metadata } from 'next'
import React from 'react'
import AddressGroupsTable from "./table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewAddressGroup from '@/app/admin/(internal)/groups/AddNew'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Addresses Group - ${appName}`,
  }
}

export default function GroupsPage() {
  return (
    <>
      <PageHeader
        title="Address Groups"
        subtitle="Organize keys into groups with shared services and revenue shares."
        actions={<AddNewAddressGroup />}
      />
      <PageContent>
        <AddressGroupsTable />
      </PageContent>
    </>
  )
}
