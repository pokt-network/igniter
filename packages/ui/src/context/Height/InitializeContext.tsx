import React from 'react'
import HeightContextProvider from './height'
import { getStatusQuery } from '../../api/blocks'

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
    console.error(e)
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
