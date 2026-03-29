import type { Metadata } from 'next'
import React from 'react'
import ServicesTable from "@/app/admin/(internal)/services/table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewService from '@/app/admin/(internal)/services/AddNew'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Services - ${appName}`,
  }
}

export default function ServicesPages() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Services</h1>
              <p className="text-text-secondary">
                Manage the services your supplier keys provide.
              </p>
            </div>
            <div className="flex flex-row gap-3 items-center">
              <AddNewService />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        <ServicesTable />
      </div>
    </>
  )
}
