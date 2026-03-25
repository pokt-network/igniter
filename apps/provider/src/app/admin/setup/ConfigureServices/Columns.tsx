"use client"

import { ColumnDef } from '@igniter/ui/components/table';
import type { Service } from "@igniter/db/provider/schema";
import { labelByRpcType } from '@/lib/constants'

export const columns: ColumnDef<Service>[] = [
  {
    accessorKey: "serviceId",
    header: "Service ID",
  },
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "endpoints",
    header: "Protocols",
    cell: ({ row }) => {
      const endpoints = row.getValue("endpoints") as Service["endpoints"];

      if (!endpoints || endpoints.length === 0) {
        return "-";
      }

      return (
        <div className="flex gap-2">
          {endpoints.map((endpoint, index) => (
            <div key={`protocol-${endpoint.rpcType}-${index}`} title={endpoint.url} className="text-xs px-2 py-1 rounded-full cursor-pointer" style={{ background: 'rgba(2, 90, 242, 0.12)', color: 'var(--pnf-blue-light, #5ba3f5)', border: '1px solid rgba(2, 90, 242, 0.2)' }}>
              {labelByRpcType[endpoint.rpcType] || endpoint.rpcType}
            </div>
          ))}
        </div>
      );
    },
  },
];
