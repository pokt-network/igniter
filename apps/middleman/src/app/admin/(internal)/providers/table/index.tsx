'use client';

import React from 'react'
import DataTable from "@igniter/ui/components/DataTable/index";
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
  );
}
