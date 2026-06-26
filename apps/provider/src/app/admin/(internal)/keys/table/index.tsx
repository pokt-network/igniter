'use client'

import { ListKeys, CountKeys } from '@/actions/Keys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import DataTable, { selectionColumn } from '@igniter/ui/components/DataTable/index'
import LoadNewButton from '@igniter/ui/components/DataTable/LoadNewButton'
import { getColumns, getFilters, sorts } from './columns'
import { ListPendingUnstakeAddresses } from '@/actions/Transactions'
import { ListBasicAddressGroups } from '@/actions/AddressGroups'
import { KeyWithRelations } from '@igniter/db/provider/schema'
import { KeyState } from '@igniter/db/provider/enums'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'
import { useKeysSelection } from '@/app/admin/(internal)/keys/KeysSelectionContext'
import type { ColumnDef } from '@tanstack/react-table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'

// Non-terminal key states: a transition is in flight, so the list should refresh
// promptly to reflect it (stake completing, services being configured, unstaking,
// remediation). Terminal states (Available/Staked/Unstaked/Retired/Failed) are stable
// until the operator or chain acts.
const TRANSIENT_KEY_STATES: KeyState[] = [
  KeyState.Delivered,
  KeyState.Staking,
  KeyState.Unstaking,
  KeyState.Imported,
  KeyState.MissingStake,
  KeyState.AttentionNeeded,
]

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
  const { setSelectedKeyIds } = useKeysSelection()

  // Polls every 4s for addresses with an in-flight unstake (pending, or recently
  // settled within the linger window). Drives the fast "Unstaking…" badge override
  // and gates the keys-list polling below.
  const { data: pendingUnstakeAddresses } = useQuery({
    queryKey: ['keys-pending-unstake'],
    queryFn: async () => {
      const r = await ListPendingUnstakeAddresses()
      return new Set(r.success ? r.data : [])
    },
    refetchInterval: 4000,
  })

  const hasPendingUnstake = (pendingUnstakeAddresses?.size ?? 0) > 0

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
    // Keep the list live without a manual refresh. Poll fast (4s) while something is in
    // flight — a pending unstake, or any key mid-transition — so user-driven actions feel
    // immediate (e.g. the retiredAt that lands on unstake verification, or a stake moving
    // through Delivered→Staking→Staked). Otherwise fall back to a gentle baseline (15s)
    // so background sweeps (service config landing a sweep after the stake, balance and
    // remediation updates) still surface on their own.
    refetchInterval: (query) => {
      const keys = query.state.data?.keys ?? []
      const hasTransientKey = keys.some((k) => TRANSIENT_KEY_STATES.includes(k.state))
      return hasPendingUnstake || hasTransientKey ? 4000 : 15000
    },
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

  const onSelectionChange = React.useCallback(
    (selectedRows: KeyWithRelations[]) => {
      setSelectedKeyIds(selectedRows.map((r) => r.id))
    },
    [setSelectedKeyIds],
  )

  // The companion query returns a fresh Set every 4s poll, so depending on the Set
  // reference would rebuild every column def every 4s. Depend on a stable signature of the
  // Set CONTENTS instead — columns only re-derive when the pending-unstake set actually
  // changes. (getColumns uses the set solely for `.has(address)` checks, so a same-contents
  // Set is interchangeable.)
  const pendingUnstakeKey = React.useMemo(
    () => Array.from(pendingUnstakeAddresses ?? []).sort().join(','),
    [pendingUnstakeAddresses],
  )
  const tableColumns = React.useMemo(
    () => [selectionColumn<KeyWithRelations>(), ...getColumns(pendingUnstakeAddresses)] as Array<ColumnDef<KeyWithRelations, unknown> & CsvColumnDef<KeyWithRelations>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingUnstakeKey],
  )

  return (
    <DataTable
      columns={tableColumns}
      columnVisibility={{ addressGroup: false }}
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
      enableRowSelection
      getRowId={(row) => String(row.id)}
      onSelectionChange={onSelectionChange}
    />
  )
}