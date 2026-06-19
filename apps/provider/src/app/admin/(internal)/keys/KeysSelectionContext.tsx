'use client'

import React, { createContext, useContext, useState } from 'react'

interface KeysSelectionContextValue {
  selectedKeyIds: number[]
  setSelectedKeyIds: (ids: number[]) => void
  clearSelection: () => void
}

const KeysSelectionContext = createContext<KeysSelectionContextValue | null>(null)

export function KeysSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedKeyIds, setSelectedKeyIds] = useState<number[]>([])

  const clearSelection = () => setSelectedKeyIds([])

  return (
    <KeysSelectionContext.Provider value={{ selectedKeyIds, setSelectedKeyIds, clearSelection }}>
      {children}
    </KeysSelectionContext.Provider>
  )
}

export function useKeysSelection(): KeysSelectionContextValue {
  const ctx = useContext(KeysSelectionContext)
  if (!ctx) throw new Error('useKeysSelection must be used within KeysSelectionProvider')
  return ctx
}
