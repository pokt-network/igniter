import type { Metadata } from 'next'
import React from 'react'
import RegionsTable from "./table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewRegion from '@/app/admin/(internal)/regions/AddNew'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
    const appName = await GetAppName()

    return {
        title: `Regions - ${appName}`,
    }
}

export default function RegionsPage() {
    return (
        <>
            <PageHeader
                title="Regions"
                subtitle="Configure geographic regions for your relay miners."
                actions={<AddNewRegion />}
            />
            <PageContent>
                <RegionsTable />
            </PageContent>
        </>
    )
}
