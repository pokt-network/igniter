'use client'

import React, {createContext, PropsWithChildren, useContext, useState} from 'react'
import {DetailResolver} from './DetailResolver'
import {ItemBase, QuickDetailRendererMap} from "./types";


export interface QuickDetailProviderProps<Item extends ItemBase> {
  renderers: QuickDetailRendererMap<Item>
  children: React.ReactNode
}

interface DetailContextValue<Item extends ItemBase> {
  items: Array<Item | Promise<Item>>
  addItem: (item: Item | Promise<Item>) => void
  updateItem: (item: Item | Promise<Item>, index: number) => void
  removeLastItem: () => void
  clearItems: () => void
}

const DetailContext = createContext<DetailContextValue<any> | null>(null)

export default function QuickDetailProvider<Item extends ItemBase>({
                                                                     renderers,
                                                                     children,
                                                                   }: PropsWithChildren<QuickDetailProviderProps<Item>>) {
  const [items, setItems] = useState<Array<Item | Promise<Item>>>([])

  const addItem = (item: Item | Promise<Item>) => setItems(prev => [...prev, item])

  const updateItem = (item: Item | Promise<Item>, index: number) =>
    setItems(prev => {
      prev[index] = item
      return [...prev]
    })

  const removeLastItem = () => setItems(prev => prev.slice(0, prev.length - 1))

  const clearItems = () => setItems([])

  return (
    <DetailContext.Provider value={{items, addItem, updateItem, removeLastItem, clearItems}}>
      <DetailResolver<Item>
        items={items}
        renderers={renderers}
        clearItems={clearItems}
        back={removeLastItem}
      />
      {children}
    </DetailContext.Provider>
  )
}

export function useDetailContext<Item extends ItemBase>() {
  const ctx = useContext(DetailContext)
  if (!ctx) throw new Error('useDetailContext must be used within QuickDetailProvider')
  return ctx as DetailContextValue<Item>
}

export function useAddItemToDetail<Item extends ItemBase>() {
  return useDetailContext<Item>().addItem
}

export function useRemoveLastItemFromDetail<Item extends ItemBase>() {
  return useDetailContext<Item>().removeLastItem
}

export * from './types';