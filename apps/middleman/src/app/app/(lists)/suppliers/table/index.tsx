'use client'

import DataTable from '@igniter/ui/components/DataTable/index'
import { columns, filters, NodeDetails, sorts } from './columns'
import { GetUserNodes } from '@/actions/Nodes'
import { useQuery } from '@tanstack/react-query'
import {ItemBase, useDetailContext} from '@igniter/ui/components/QuickDetails/Provider'
import { useEffect } from 'react'

export default function NodesTable() {
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: ["nodes"],
    queryFn: GetUserNodes,
    refetchInterval: 60000,
  });
  const {items, updateItem} = useDetailContext()

  useEffect(() => {
    const updateDetailItem = (item: ItemBase, index: number) => {
      if (item.type === 'node') {
        const node = data?.find((n) => n.id === item.body.id)

        if (node) {
          updateItem({
            type: "node",
            body: {
              id: node.id,
              address: node.address,
              ownerAddress: node.ownerAddress,
              status:  node.status,
              provider: node.provider || null,
              stakeAmount: Number(node.stakeAmount),
              operationalFundsAmount: Number(node.balance.toString()),
              services: node.services ?? [],
            }
          }, index)
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!

      // in theory, this promise is already awaited because when we push a new item,
      // it shows to the user so if it was a promise, it will be awaited
      if ('then' in item) {
        item.then((awaitedItem) => updateDetailItem(awaitedItem, i))
      } else {
        updateDetailItem(item, i)
      }
    }
  }, [data])

  const nodes: Array<NodeDetails> = data?.map((node) => {
    return {
      ...node,
      provider: node.provider ?? null,
      stakeAmount: node.stakeAmount,
      height: node.lastUpdatedHeight ?? 0,
    }
  }) || [];

  return (
    <DataTable
      columns={columns}
      data={nodes}
      filters={filters}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      csvFilename={'nodes'}
      searchableColumns={['address', 'ownerAddress', 'provider']}
      searchPlaceholder="Search by address or provider..."
    />
  )
}
