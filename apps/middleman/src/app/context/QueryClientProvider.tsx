'use client'
import { QueryClientProvider as TanStackQueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { createQueryClient } from './queryClient'

export default function QueryClientProvider({children}: React.PropsWithChildren) {
  // One client per mount, not per render: a client built in the render body is a
  // fresh cache on every re-render (`children` changes on every navigation), and
  // the running polls keep writing to the orphaned one. Same rationale as the
  // shared provider in @igniter/ui.
  const [queryClient] = React.useState(createQueryClient)

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  )
}
