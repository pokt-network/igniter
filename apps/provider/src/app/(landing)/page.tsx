import type { Metadata } from "next";
import React from 'react'
import CurrentUser from '@/components/CurrentUser'
import { GetAppName } from '@/actions/ApplicationSettings'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Sign In - ${appName}`,
    description: `Light up your earnings with ${appName}`,
  }
}

export default function Landing() {
  return (
    <div className="flex flex-col items-center justify-center text-center w-full max-w-[400px] gap-3 py-10 px-4 bg-bg-surface sm:border border-border-primary rounded-lg">
      <h1 className={'font-bold'}>Stake Igniter Provider</h1>
      <p className={'mb-3'}>
        If you are an admin, please sign in to continue.
      </p>
      <CurrentUser />
    </div>
  )
}
