import type { Metadata } from 'next'
import React from 'react'
import AddressGroupsTable from "./table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewAddressGroup from '@/app/admin/(internal)/groups/AddNew'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Addresses Group - ${appName}`,
  }
}

export default function GroupsPage() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Address Groups</h1>
              <p className="text-text-secondary">
                Organize keys into groups with shared services and revenue shares.
              </p>
            </div>
            <div className="flex flex-row gap-3 items-center">
              <AddNewAddressGroup />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        <AddressGroupsTable />
      </div>
    </>
  )
}
