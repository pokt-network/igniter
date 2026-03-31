import type { Metadata } from 'next'
import React from 'react'
import ServicesTable from "@/app/admin/(internal)/services/table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewService from '@/app/admin/(internal)/services/AddNew'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Services - ${appName}`,
  }
}

export default function ServicesPages() {
  return (
    <>
      <PageHeader
        title="Services"
        subtitle="Manage the services your supplier keys provide."
        actions={<AddNewService />}
      />
      <PageContent>
        <ServicesTable />
      </PageContent>
    </>
  )
}
