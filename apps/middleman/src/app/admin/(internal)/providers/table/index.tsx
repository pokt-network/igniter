'use client';

import React from 'react'
import DataTable from "@igniter/ui/components/DataTable/index";
import LoadNewButton from '@igniter/ui/components/DataTable/LoadNewButton'
import {columns, filters, sorts} from "./columns";
import { ListProviders, CountProviders } from "@/actions/Providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function ProvidersTable() {
  const queryClient = useQueryClient()
  const [acknowledgedCount, setAcknowledgedCount] = React.useState<number | null>(null)

  const {data: delegators, refetch, isLoading, isError} = useQuery({
    queryKey: ['providers'],
    queryFn: () => ListProviders(true),
    refetchOnWindowFocus: false,
  });

  const { data: totalCount } = useQuery({
    queryKey: ['providers-count'],
    queryFn: () => CountProviders(),
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
    await queryClient.invalidateQueries({ queryKey: ['providers-count'] })
    setAcknowledgedCount(totalCount ?? 0)
  }

  return (
    <DataTable
      columns={columns}
      data={delegators || []}
      filters={filters}
      columnVisibility={{
        enabled: false,
        visible: false,
      }}
      sorts={sorts}
      isError={isError}
      isLoading={isLoading}
      refetch={refetch}
      searchableColumns={['name', 'identity']}
      searchPlaceholder="Search by name or identity..."
      countLabel="providers"
      headerLeft={<LoadNewButton count={newCount} onClick={handleLoadNew} />}
    />
  );
}
