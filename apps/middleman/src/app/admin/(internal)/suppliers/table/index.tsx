'use client'

import React from 'react'
import DataTable from '@igniter/ui/components/DataTable/index'
import { columns, getFilters, sorts } from './columns'
import { GetAllNodes, CountAllNodes } from '@/actions/Nodes'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export default function SuppliersTable() {
  const queryClient = useQueryClient()
  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-suppliers'],
    queryFn: GetAllNodes,
    refetchOnWindowFocus: false,
  })

  const { data: totalCount } = useQuery({
    queryKey: ['admin-suppliers-count'],
    queryFn: CountAllNodes,
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
    await queryClient.invalidateQueries({ queryKey: ['admin-suppliers-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  const providerNames = React.useMemo(() => {
    if (!data) return []
    const names = new Set(data.map((n) => n.provider?.name).filter(Boolean) as string[])
    return Array.from(names).sort()
  }, [data])

  return (
    <DataTable
      columns={columns}
      data={data || []}
      filters={getFilters(providerNames)}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      searchableColumns={['address', 'ownerAddress', 'provider']}
      searchPlaceholder="Search by address, owner, or provider..."
      countLabel="suppliers"
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
