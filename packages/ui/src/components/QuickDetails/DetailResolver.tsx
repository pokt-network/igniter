'use client'

import React, { useRef } from 'react'
import { Drawer, DrawerClose, DrawerContent } from '@igniter/ui/components/drawer'
import { Button } from '@igniter/ui/components/button'
import { ArrowBackIcon, LoaderIcon, XIcon } from '@igniter/ui/assets'
import { clsx } from 'clsx'
import DetailHeader from './Header'
import {ItemBase, QuickDetailRendererMap} from "./types";

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as any).then === 'function'
}

interface DetailResolverProps<Item extends ItemBase> {
  items: Array<Item | Promise<Item>>
  renderers: QuickDetailRendererMap<Item>
  clearItems: () => void
  back: () => void
}

export function DetailResolver<Item extends ItemBase>({
                                                                        items,
                                                                        renderers,
                                                                        clearItems,
                                                                        back,
                                                                      }: DetailResolverProps<Item>) {
  const lastItemRef = useRef<Item | Promise<Item> | null>(null)
  const lastItemFromArray = items.at(-1)
  const lastItem = lastItemFromArray ?? lastItemRef.current

  const renderResolved = (item: Item) => {
    // TODO: Figure out how to refine the renderers map to support this.
    // @ts-ignore
    const Comp = renderers[item.type] as (i: Item) => React.ReactNode
    return <>{Comp(item as never)}</>
  }

  const PromiseItem = ({ item }: { item: Promise<Item> }) => {
    const [{ isLoading, error, data }, setState] = React.useState<{
      isLoading: boolean
      error: Error | null
      data: Item | null
    }>({
      isLoading: true,
      error: null,
      data: null,
    })

    React.useEffect(() => {
      setState({ isLoading: true, error: null, data: null })
      item
        .then(d => setState({ isLoading: false, error: null, data: d }))
        .catch(err => setState({ isLoading: false, error: err, data: null }))
    }, [item])

    if (isLoading) {
      return (
        <div className="w-full h-[calc(100%-72px)] flex items-center justify-center">
          <div className="hidden">
            <DetailHeader title="Loading" description="loading..." />
          </div>
          <div className="scale-200">
            <LoaderIcon className="animate-spin" />
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <p>Error</p>
        </div>
      )
    }

    return renderResolved(data!)
  }

  return (
    <Drawer
      open={!!lastItemFromArray}
      direction="right"
      onClose={() => {
        lastItemRef.current = lastItemFromArray ?? null
        clearItems()
      }}
    >
      <DrawerContent className="!w-[478px] !max-w-[478px]">
        <div className="relative h-full max-h-sm w-[478px] px-[32px] overflow-auto pb-8 pt-6">
          <div className="absolute top-6 right-6 flex items-center gap-2 z-10">
            {items.length > 1 && (
              <Button variant="icon" className="h-[30px]" onClick={back}>
                <ArrowBackIcon className="text-text-tertiary hover:text-text-primary" />
              </Button>
            )}

            <DrawerClose asChild>
              <Button variant="icon" className="h-[30px]">
                <XIcon className="text-text-tertiary hover:text-text-primary" />
              </Button>
            </DrawerClose>
          </div>

          {isPromise(lastItem)
            ? <PromiseItem item={lastItem as Promise<Item>} />
            : lastItem && renderResolved(lastItem as Item)}
        </div>
      </DrawerContent>
    </Drawer>
  )
}