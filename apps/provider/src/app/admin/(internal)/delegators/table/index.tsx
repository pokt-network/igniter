'use client';

import DataTable from "@igniter/ui/components/DataTable/index";
import {columns, filters, sorts} from "./columns";
import {
  ListDelegators,
} from "@/actions/Delegators";
import {useQuery} from "@tanstack/react-query";

export default function DelegatorsTable() {
  const {data: delegators, isError, isLoading, refetch} = useQuery({
    queryKey: ['delegators'],
    queryFn: async () => {
      const result = await ListDelegators();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: []
  });

  const content = (
    <DataTable
      columns={columns}
      data={delegators}
      filters={filters}
      sorts={sorts}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
    />
  );

  return (
    <div className='flex flex-col gap-4'>
      <div className="py-2 max-h-[500px] min-h-[300px] overflow-y-scroll scrollbar-hidden">
        {content}
      </div>
    </div>
  );
}
