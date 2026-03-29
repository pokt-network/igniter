import type { Metadata } from 'next'
import React from 'react';
import {
  GetAppName,
} from '@/actions/ApplicationSettings'
import SettingsForm from '@/app/admin/(internal)/settings/Form'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Settings - ${appName}`,
  }
}

export default function SettingsPage() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Settings</h1>
              <p className="text-text-secondary">
                Configure your provider application settings.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        <SettingsForm />
      </div>
    </>
  )
}
