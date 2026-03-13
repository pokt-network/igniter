'use client'

import DataTable from '@igniter/ui/components/DataTable/index'
import { columns, filters, NodeDetails, sorts } from './columns'
import { GetUserNodes } from '@/actions/Nodes'
import { useQuery } from '@tanstack/react-query'
import {ItemBase, useDetailContext} from '@igniter/ui/components/QuickDetails/Provider'
import { useEffect } from 'react'

const getHeight = (transactions: NodeDetails['transactions']) => {
  const stakeTxs = transactions
    ?.filter((tx) => tx.type === "Stake");

  if (!stakeTxs || stakeTxs.length === 0) return undefined;

  const mostRecentStake = stakeTxs
    .slice()
    .sort((a, b) =>
      new Date(b.createdAt!).getTime() -
      new Date(a.createdAt!).getTime()
    )[0];

  return mostRecentStake?.executionHeight;
}

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
              transactions: node.transactionsToNodes.map((transaction) => transaction.transaction).map(t => ({
                id: t.id,
                type: t.type,
                status: t.status,
                createdAt: t.createdAt!,
                operations: JSON.parse(t.unsignedPayload).body.messages,
                hash: t.hash || '',
                estimatedFee: t.estimatedFee,
                consumedFee: t.consumedFee,
                provider: node.provider?.name || '',
                providerFee: t.providerFee,
                typeProviderFee: t.typeProviderFee,
              })),
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
    const transactions = node.transactionsToNodes.map((transaction) => transaction.transaction)
    return {
      ...node,
      provider: node.provider ?? null,
      stakeAmount: node.stakeAmount,
      transactions,
      height: getHeight(transactions) || 0,
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
    />
  )
}
