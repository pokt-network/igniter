'use client'

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import LoadNewButton from '@igniter/ui/components/DataTable/LoadNewButton'
import { columns, getFilters, sorts } from './columns'
import { ListTransactions, CountTransactions } from '@/actions/Transactions'
import type { Transaction } from '@igniter/db/provider/schema'

export default function TransactionsTable() {
  const queryClient = useQueryClient()
  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      const result = await ListTransactions(200)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    refetchOnWindowFocus: false,
  })

  const { data: totalCount } = useQuery({
    queryKey: ['transactions-count'],
    queryFn: async () => {
      const result = await CountTransactions()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
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
    await queryClient.invalidateQueries({ queryKey: ['transactions-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  const transactions: Transaction[] = data ?? []

  return (
    <DataTable
      columns={columns}
      data={transactions}
      filters={getFilters()}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      searchableColumns={['keyAddress', 'hash']}
      searchPlaceholder="Search by supplier or tx hash..."
      countLabel="txs"
      headerLeft={<LoadNewButton count={newCount} onClick={handleLoadNew} />}
    />
  )
}
