'use client'
import React from 'react'
import DataTable from '@igniter/ui/components/DataTable/index'
import { columns, filters, sorts } from './columns'
import {ItemBase, useDetailContext} from '@igniter/ui/components/QuickDetails/Provider'
import { MessageType } from '@/lib/constants'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GetTransactions, CountTransactions } from '@/actions/Transactions'
import {Operation} from "@/app/detail/TransactionDetail";

export default function TransactionsTable() {
  const queryClient = useQueryClient()
  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-transactions"],
    queryFn: GetTransactions,
    refetchOnWindowFocus: false,
  });
  const {items, updateItem} = useDetailContext()

  const { data: totalCount } = useQuery({
    queryKey: ['admin-transactions-count'],
    queryFn: CountTransactions,
    refetchInterval: 10000,
  })

  React.useEffect(() => {
    if (totalCount !== undefined && acknowledgedCount === null) {
      setAcknowledgedCount(totalCount)
    }
  }, [totalCount, acknowledgedCount])

  const newCount = acknowledgedCount !== null && totalCount !== undefined
    ? Math.max(0, totalCount - acknowledgedCount)
    : 0

  const handleLoadNew = async () => {
    await refetch()
    await queryClient.invalidateQueries({ queryKey: ['admin-transactions-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  React.useEffect(() => {
    const updateTxDetail = (item: ItemBase, index: number) => {
      if (item.type === 'transaction') {
        const newTx = data?.find((tx) => tx.id === item.body.id)

        if (newTx) {
          updateItem({
            type: "transaction",
            body: {
              id: newTx.id,
              type: newTx.type,
              hash: newTx.hash || '',
              status: newTx.status,
              createdAt: new Date(newTx.createdAt!),
              operations: JSON.parse(newTx.unsignedPayload).body.messages,
              estimatedFee: newTx.estimatedFee,
              consumedFee: newTx.consumedFee,
              provider: newTx.provider?.name || '',
              providerFee: newTx.providerFee,
              typeProviderFee: newTx.typeProviderFee
            }
          }, index)
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!

      if ('then' in item) {
        item.then((awaitedItem) => updateTxDetail(awaitedItem, i))
      } else {
        updateTxDetail(item, i)
      }
    }
  }, [data])

  return (
    <DataTable
      columns={columns}
      data={
        data?.map((tx) => {
          const operations = JSON.parse(tx.unsignedPayload).body.messages as Array<Operation>

          return {
            id: tx.id,
            type: tx.type,
            status: tx.status,
            createdAt: new Date(tx.createdAt!),
            executionHeight: `${tx.executionHeight ?? ''}`,
            totalValue: operations.reduce((acc, op) => {
              if (op.typeUrl === MessageType.Send) {
                return acc + Number(op.value.amount.at(0)?.amount || 0)
              }

              if (op.typeUrl === MessageType.Stake) {
                return acc + Number(op.value.stake.amount)
              }

              return acc
            }, 0),
            operations,
            hash: tx.hash || '',
            estimatedFee: tx.estimatedFee,
            consumedFee: tx.consumedFee,
            provider: tx.provider?.name || 'Height Pending',
            providerFee: tx.providerFee,
            typeProviderFee: tx.typeProviderFee,
          }
        }) || []
      }
      filters={filters}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      csvFilename={'admin_transactions'}
      searchableColumns={['hash', 'provider']}
      searchPlaceholder="Search by hash or provider..."
      countLabel="transactions"
      headerLeft={
        newCount > 0 ? (
          <button
            onClick={handleLoadNew}
            className="inline-flex items-center gap-1.5 whitespace-nowrap h-9 px-4 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors cursor-pointer"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            +{newCount} new
          </button>
        ) : undefined
      }
    />
  )
}
