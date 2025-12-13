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
  const data = await getStatusQuery(graphQlUrl)

  return (
    <HeightContextProvider
      firstHeight={Number(data?.height?.toString() || 0)}
      firstTime={data?.timestamp}
      networkHeight={data?.networkHeight}
    >
      {children}
    </HeightContextProvider>
  )
}
