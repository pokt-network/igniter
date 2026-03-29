"use client"

import { ColumnDef } from '@igniter/ui/components/table'
import { FilterGroup, SortOption } from "@igniter/ui/components/DataTable/index"
import { NodeStatus } from "@igniter/db/middleman/enums"
import Address from '@igniter/ui/components/Address'
import Amount from '@igniter/ui/components/Amount'
import { amountToPokt } from '@igniter/ui/lib/utils'
import type { NodeWithDetails } from '@igniter/db/middleman/schema'

const StatusLabels: Record<string, string> = {
  [NodeStatus.Staked]: 'Staked',
  [NodeStatus.Unstaking]: 'Unstaking',
  [NodeStatus.Unstaked]: 'Unstaked',
}

const StatusStyles: Record<string, string> = {
  [NodeStatus.Staked]: 'text-emerald-400',
  [NodeStatus.Unstaking]: 'text-yellow-400',
  [NodeStatus.Unstaked]: 'text-text-tertiary',
}

export const columns: ColumnDef<NodeWithDetails>[] = [
  {
    accessorKey: "address",
    header: "Address",
    cell: ({ row }) => <Address address={row.getValue("address")} />,
  },
  {
    accessorKey: "ownerAddress",
    header: "Owner",
    cell: ({ row }) => <Address address={row.getValue("ownerAddress")} />,
  },
  {
    id: "provider",
    header: "Provider",
    accessorFn: (row) => row.provider?.name || '-',
    cell: ({ getValue }) => (
      <span className="text-slightly-muted-foreground">{getValue() as string}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      return (
        <span className={`flex justify-center font-medium ${StatusStyles[status] || ''}`}>
          {StatusLabels[status] || status}
        </span>
      )
    },
  },
  {
    accessorKey: "stakeAmount",
    header: "Staked",
    meta: { headerAlign: 'right' },
    cell: ({ row }) => {
      const amount = row.getValue("stakeAmount") as string
      return (
        <div className="flex justify-end font-mono">
          <Amount value={amountToPokt(amount)} />
        </div>
      )
    },
  },
  {
    id: "services",
    header: "Services",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const services = row.original.services || []
      return (
        <span className="flex justify-center text-slightly-muted-foreground">
          {services.length}
        </span>
      )
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const date = row.getValue("updatedAt") as Date | null
      if (!date) return '-'
      return (
        <span className="font-mono text-slightly-muted-foreground flex justify-center">
          {new Date(date).toLocaleString()}
        </span>
      )
    },
  },
]

export function getFilters(providerNames: string[]): Array<FilterGroup<NodeWithDetails>> {
  return [
    {
      group: "status",
      items: [
        [{ label: "All", value: "", column: "status", isDefault: true }],
        Object.values(NodeStatus).map((status) => ({
          label: StatusLabels[status] || status,
          value: status,
          column: "status" as const,
        })),
      ],
    },
    ...(providerNames.length > 0 ? [{
      group: "provider",
      items: [
        [{ label: "All Providers", value: "", column: "provider" as const, isDefault: true }],
        providerNames.map((name) => ({
          label: name,
          value: name,
          column: "provider" as const,
        })),
      ],
    }] : []),
  ]
}

export const sorts: Array<Array<SortOption<NodeWithDetails>>> = [
  [
    {
      label: "Recently Updated",
      column: "updatedAt",
      direction: "desc",
      isDefault: true,
    },
  ],
  [
    { label: "Stake Amount", column: "stakeAmount", direction: "desc" },
    { label: "Status", column: "status", direction: "asc" },
  ],
]
