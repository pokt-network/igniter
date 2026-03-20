'use client';

import DataTable from "@igniter/ui/components/DataTable/index";
import {columns, filters, sorts} from "./columns";
import {
  ListProviders,
} from "@/actions/Providers";
import {useQuery} from "@tanstack/react-query";

export default function ProvidersTable() {
  const {data: delegators, refetch: fetchDelegators, isLoading, isError} = useQuery({
    queryKey: ['providers'],
    queryFn: () => ListProviders(true),
    refetchInterval: 60000,
  });

  const content = (
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
      refetch={fetchDelegators}
    />
  );

  return (
    <div className='flex flex-col gap-4'>
      <div className="py-2">
        {content}
      </div>
    </div>
  );
}
