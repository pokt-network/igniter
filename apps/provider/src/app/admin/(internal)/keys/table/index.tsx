'use client'

import { ListKeys, CountKeys } from '@/actions/Keys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import DataTable from '@igniter/ui/components/DataTable/index'
import {columns, getFilters, sorts} from './columns'
import { ListBasicAddressGroups } from '@/actions/AddressGroups'
import {KeyWithRelations} from "@igniter/db/provider/schema";

export default function KeysTable() {
  const queryClient = useQueryClient()
  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const {data, isLoading, isError, refetch} = useQuery({
    queryKey: ['keys'],
    queryFn: async () => {
      const [keysResult, addressesGroupResult] = await Promise.all([
        ListKeys(),
        ListBasicAddressGroups(),
      ]);

      if (!keysResult.success) {
        throw new Error(keysResult.error.message);
      }
      if (!addressesGroupResult.success) {
        throw new Error(addressesGroupResult.error.message);
      }

      return {
        keys: keysResult.data,
        addressesGroup: addressesGroupResult.data
      }
    },
    refetchOnWindowFocus: false,
  })

  const { data: totalCount } = useQuery({
    queryKey: ['keys-count'],
    queryFn: async () => {
      const result = await CountKeys()
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
    await queryClient.invalidateQueries({ queryKey: ['keys-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  const keys: KeyWithRelations[] = data?.keys ?? []

  return (
    <DataTable
      columns={columns}
      data={keys}
      filters={getFilters(data?.addressesGroup || [], keys)}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      searchableColumns={['address', 'ownerAddress', 'delegator']}
      searchPlaceholder="Search by address, owner, or delegator..."
      countLabel="keys"
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
