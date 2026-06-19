import { ColumnDef } from "@igniter/ui/components/table"
import { FilterGroup, SortOption } from '@igniter/ui/components/DataTable/index'
import Address from '@igniter/ui/components/Address'
import type { Transaction } from '@igniter/db/provider/schema'
import { TransactionStatus, TransactionType, TransactionTrigger, RemediationHistoryEntryReason } from '@igniter/db/provider/enums'

const StatusLabels: Record<string, string> = {
  [TransactionStatus.Pending]: 'Pending',
  [TransactionStatus.Success]: 'Success',
  [TransactionStatus.Failure]: 'Failed',
}

const StatusStyles: Record<string, string> = {
  [TransactionStatus.Pending]: 'text-yellow-400',
  [TransactionStatus.Success]: 'text-emerald-400',
  [TransactionStatus.Failure]: 'text-red-400',
}

const TypeLabels: Record<string, string> = {
  [TransactionType.Stake]: 'Stake',
  [TransactionType.Unstake]: 'Unstake',
  [TransactionType.ReturnFunds]: 'Return Funds',
}

const ReasonLabels: Record<string, string> = {
  [RemediationHistoryEntryReason.ServiceMismatch]: 'Service Mismatch',
  [RemediationHistoryEntryReason.DelegatorAddressMissing]: 'Delegator Missing',
  [RemediationHistoryEntryReason.OwnerInitialStake]: 'Initial Stake',
  [RemediationHistoryEntryReason.SupplierStakeTooLow]: 'Stake Too Low',
  [RemediationHistoryEntryReason.SupplierFundsTooLow]: 'Funds Too Low',
  [RemediationHistoryEntryReason.AddressGroupMigration]: 'Address Group Migration',
  [RemediationHistoryEntryReason.ManualUnstake]: 'Manual Unstake',
  [RemediationHistoryEntryReason.ReturnSupplierFunds]: 'Return Funds',
}

const TriggerLabels: Record<string, string> = {
  [TransactionTrigger.Manual]: 'Manual',
  [TransactionTrigger.Automatic]: 'Auto',
}

export const columns: Array<ColumnDef<Transaction>> = [
  {
    accessorKey: "hash",
    header: "Tx Hash",
    cell: ({ row }) => {
      const hash = row.getValue("hash") as string | null
      if (!hash) return <span className="text-slightly-muted-foreground">-</span>
      return <Address address={hash} />
    },
  },
  {
    accessorKey: "keyAddress",
    header: "Supplier",
    cell: ({ row }) => {
      const address = row.getValue("keyAddress") as string
      return <Address address={address} />
    },
  },
  {
    accessorKey: "type",
    header: "Type",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const type = row.getValue("type") as string
      return (
        <span className="flex justify-center text-slightly-muted-foreground">
          {TypeLabels[type] || type}
        </span>
      )
    },
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
    accessorKey: "reason",
    header: "Reason",
    cell: ({ row }) => {
      const reason = row.getValue("reason") as string | null
      return (
        <span className="text-slightly-muted-foreground">
          {reason ? (ReasonLabels[reason] || reason) : '-'}
        </span>
      )
    },
  },
  {
    accessorKey: "trigger",
    header: "Trigger",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const trigger = row.getValue("trigger") as string | null
      return (
        <span className="flex justify-center text-slightly-muted-foreground">
          {trigger ? (TriggerLabels[trigger] || trigger) : '-'}
        </span>
      )
    },
  },
  {
    accessorKey: "executionHeight",
    header: "Height",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const height = row.getValue("executionHeight") as number | null
      return (
        <span className="font-mono text-slightly-muted-foreground flex justify-center">
          {height ?? '-'}
        </span>
      )
    },
  },
  {
    accessorKey: "createdAt",
    header: "Date",
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const createdAt = row.getValue("createdAt")
      if (!createdAt) return '-'
      const date = new Date(createdAt as string)
      return (
        <span className="font-mono text-slightly-muted-foreground flex justify-center">
          {date.toLocaleString()}
        </span>
      )
    },
  },
]

export function getFilters(): Array<FilterGroup<Transaction>> {
  return [
    {
      group: "status",
      items: [
        [{ label: "All", value: "", column: "status", isDefault: true }],
        Object.values(TransactionStatus).map((status) => ({
          label: StatusLabels[status] || status,
          value: status,
          column: "status",
        })),
      ],
    },
  ]
}

export const sorts: Array<Array<SortOption<Transaction>>> = [
  [
    {
      label: "Most Recent",
      column: "createdAt",
      direction: "desc",
      isDefault: true,
    },
  ],
]
