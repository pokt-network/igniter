import type { Metadata } from 'next'
import { GetAppName } from '@/actions/ApplicationSettings'
import SuppliersTable from './table'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Suppliers - ${appName}`,
  }
}

export default function SuppliersPage() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Suppliers</h1>
              <p className="text-text-secondary">
                All suppliers across all providers.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 pt-6">
        <SuppliersTable />
      </div>
    </>
  )
}
