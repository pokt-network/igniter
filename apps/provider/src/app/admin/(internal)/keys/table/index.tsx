'use client'

import { ListKeys, CountKeys } from '@/actions/Keys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import DataTable from '@igniter/ui/components/DataTable/index'
import LoadNewButton from '@igniter/ui/components/DataTable/LoadNewButton'
import { columns, getFilters, sorts } from './columns'
import { ListBasicAddressGroups } from '@/actions/AddressGroups'
import { KeyWithRelations } from '@igniter/db/provider/schema'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'

export default function KeysTable() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const addItem = useAddItemToDetail()

  const addressParam = searchParams.get('address')
  const [highlightedAddress, setHighlightedAddress] = React.useState<string | null>(
    () => addressParam,
  )
  const openedRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (addressParam) setHighlightedAddress(addressParam)
  }, [addressParam])

  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['keys'],
    queryFn: async () => {
      const [keysResult, addressesGroupResult] = await Promise.all([
        ListKeys(),
        ListBasicAddressGroups(),
      ])

      if (!keysResult.success) throw new Error(keysResult.error.message)
      if (!addressesGroupResult.success) throw new Error(addressesGroupResult.error.message)

      return {
        keys: keysResult.data,
        addressesGroup: addressesGroupResult.data,
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

  const newCount =
    acknowledgedCount !== null && totalCount !== undefined
      ? Math.max(0, totalCount - acknowledgedCount)
      : 0

  const handleLoadNew = async () => {
    await refetch()
    await queryClient.invalidateQueries({ queryKey: ['keys-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  const keys: KeyWithRelations[] = data?.keys ?? []

  // Auto-open the detail panel when data is ready and an address param was provided
  React.useEffect(() => {
    if (!highlightedAddress || !data || openedRef.current === highlightedAddress) return
    const match = keys.find((k) => k.address === highlightedAddress)
    if (!match) {
      setHighlightedAddress(null)
      return
    }
    openedRef.current = highlightedAddress
    addItem({ type: 'key', body: { ...match } })
    // Remove the param from the URL without a full navigation
    const params = new URLSearchParams(searchParams.toString())
    params.delete('address')
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, {
      scroll: false,
    })
  }, [data, highlightedAddress])

  // Pin the highlighted key to the top of the list
  const displayKeys = React.useMemo(() => {
    if (!highlightedAddress) return keys
    const idx = keys.findIndex((k) => k.address === highlightedAddress)
    if (idx <= 0) return keys
    return [keys[idx]!, ...keys.slice(0, idx), ...keys.slice(idx + 1)]
  }, [keys, highlightedAddress])

  return (
    <DataTable
      columns={columns}
      data={displayKeys}
      filters={getFilters(data?.addressesGroup || [], keys)}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      searchableColumns={['address', 'ownerAddress', 'delegator']}
      searchPlaceholder="Search by address, owner, or delegator..."
      countLabel="keys"
      headerLeft={<LoadNewButton count={newCount} onClick={handleLoadNew} />}
      getRowClassName={(row) =>
        row.address === highlightedAddress
          ? 'border-l-4 border-l-blue-500 bg-blue-500/10'
          : ''
      }
    />
  )
}