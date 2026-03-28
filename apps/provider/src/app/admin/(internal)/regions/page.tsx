import type { Metadata } from 'next'
import React from 'react'
import RegionsTable from "./table";
import { GetAppName } from '@/actions/ApplicationSettings'
import AddNewRegion from '@/app/admin/(internal)/regions/AddNew'

export async function generateMetadata(): Promise<Metadata> {
    const appName = await GetAppName()

    return {
        title: `Regions - ${appName}`,
    }
}

export default function RegionsPage() {
    return (
        <>
            <div className="border-b-1">
                <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
                    <div className="flex flex-row justify-between items-center">
                        <div className="flex flex-col">
                            <h1>Regions</h1>
                            <p className="text-text-secondary">
                                Configure geographic regions for your relay miners.
                            </p>
                        </div>
                        <div className="flex flex-row gap-3 items-center">
                            <AddNewRegion />
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
                <RegionsTable />
            </div>
        </>
    )
}
