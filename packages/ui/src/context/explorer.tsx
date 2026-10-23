'use client';
import React, { createContext, useContext } from 'react'
import { explorerTxUrl } from '../lib/explorer'

// The app's chainId, provided once by each app's application settings provider, so shared
// components can link to the explorer of the network the app runs on.
const ChainIdContext = createContext<string | undefined>(undefined)

export function ChainIdProvider({ chainId, children }: React.PropsWithChildren<{ chainId?: string }>) {
  return <ChainIdContext.Provider value={chainId}>{children}</ChainIdContext.Provider>
}

export function useExplorerTxUrl(hash: string): string | null {
  return explorerTxUrl(useContext(ChainIdContext), hash)
}
