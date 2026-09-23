'use client'
import { QueryClient, QueryClientProvider as TanStackQueryClientProvider } from '@tanstack/react-query'
import React from 'react'

export default function QueryClientProvider({children}: React.PropsWithChildren) {
  // One client per mount, not per render. `new QueryClient()` in the render body
  // builds a fresh cache every time this component re-renders — and `children`
  // changes on every navigation — so the tree ends up reading a cache that the
  // still-running timers and in-flight requests from the previous instance never
  // write to. Anything long-lived and poll-driven then freezes on whatever it
  // last saw: the notification bell kept showing read events, with the right
  // count sitting in an orphaned cache, until a reload collapsed it back to one.
  const [queryClient] = React.useState(() => new QueryClient())

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  )
}
