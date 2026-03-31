import type { Metadata } from 'next'
import React from 'react'
import RelayMinersTable from "./table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewRelayMiner from '@/app/admin/(internal)/miners/AddNew'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'

export async function generateMetadata(): Promise<Metadata> {
    const appName = await GetAppName()

    return {
        title: `Relay Miners - ${appName}`,
    }
}

export default function RelayMinersPage() {
    return (
        <>
            <PageHeader
                title="Relay Miners"
                subtitle="Manage your relay miner instances."
                actions={<AddNewRelayMiner />}
            />
            <PageContent>
                <RelayMinersTable />
            </PageContent>
        </>
    )
}
