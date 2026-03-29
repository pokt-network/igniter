"use client"

import { ColumnDef } from '@igniter/ui/components/table';
import type { Service } from "@igniter/db/provider/schema";
import { labelByRpcType } from '@/lib/constants'
import {CsvColumnDef} from "@igniter/ui/lib/csv";

export const columns: Array<ColumnDef<Service> & CsvColumnDef<Service>> = [
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "serviceId",
    header: "Service ID",
    cell: ({ row }) => (
      <span className="font-mono text-text-secondary text-xs">{row.getValue("serviceId")}</span>
    ),
  },
  {
    accessorKey: "endpoints",
    header: "Protocols",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const endpoints = row.getValue("endpoints") as Service["endpoints"];

      if (!endpoints || endpoints.length === 0) {
        return "-";
      }

      return (
        <div className="flex gap-2 justify-center">
          {endpoints.map((endpoint, index) => (
            <span key={`protocol-${endpoint.rpcType}-${index}`} title={endpoint.url} className="text-xs px-2.5 py-0.5 rounded-md bg-bg-elevated text-text-secondary border border-border-primary cursor-default">
              {labelByRpcType[endpoint.rpcType.toString()] || endpoint.rpcType}
            </span>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Updated At",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const updatedAt = new Date(row.getValue("updatedAt"));
      return (
        <span className="font-mono text-slightly-muted-foreground flex justify-center gap-2">
          {updatedAt.toLocaleString()}
        </span>
      );
    },
  },
];
