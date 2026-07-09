import React from 'react'
import HeightContextProvider from './height'
import { getStatusQuery } from '../../api/blocks'
import { getLogger } from '@igniter/logger'

const log = getLogger(['ui', 'height-context'])

interface InitializeHeightContextProps {
  graphQlUrl: string
  children: React.ReactNode
}

export default async function InitializeHeightContext({
  graphQlUrl,
  children,
}: InitializeHeightContextProps) {
  let data: Awaited<ReturnType<typeof getStatusQuery>> | null = null

  try {
    data = await getStatusQuery(graphQlUrl)
  } catch (e) {
    log.error('Failed to fetch height status', { error: e })
  }

  return (
    <HeightContextProvider
      firstHeight={Number(data?.height?.toString() || 0)}
      firstTime={data?.timestamp || ''}
      networkHeight={data?.networkHeight || 0}
    >
      {children}
    </HeightContextProvider>
  )
}
