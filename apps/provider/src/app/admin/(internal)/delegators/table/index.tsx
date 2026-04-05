'use client';

import React from 'react'
import DataTable from "@igniter/ui/components/DataTable/index";
import LoadNewButton from '@igniter/ui/components/DataTable/LoadNewButton'
import {columns, filters, sorts} from "./columns";
import { ListDelegators, CountDelegators } from "@/actions/Delegators";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function DelegatorsTable() {
  const queryClient = useQueryClient()
  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const {data: delegators, isError, isLoading, refetch} = useQuery({
    queryKey: ['delegators'],
    queryFn: async () => {
      const result = await ListDelegators();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchOnWindowFocus: false,
    initialData: []
  });

  const { data: totalCount } = useQuery({
    queryKey: ['delegators-count'],
    queryFn: async () => {
      const result = await CountDelegators()
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
    await queryClient.invalidateQueries({ queryKey: ['delegators-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  return (
    <DataTable
      columns={columns}
      data={delegators}
      filters={filters}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      searchableColumns={['name', 'identity']}
      searchPlaceholder="Search by name or identity..."
      countLabel="delegators"
      headerLeft={<LoadNewButton count={newCount} onClick={handleLoadNew} />}
    />
  )
}
