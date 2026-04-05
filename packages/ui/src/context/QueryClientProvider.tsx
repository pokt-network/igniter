'use client'
import { QueryClient, QueryClientProvider as TanStackQueryClientProvider } from '@tanstack/react-query'
import React from 'react'

export default function QueryClientProvider({children}: React.PropsWithChildren) {
  const queryClient = new QueryClient()

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  )
}
