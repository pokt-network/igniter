'use client'

import type {
  AddressGroupWithDetails,
  RelayMiner,
} from '@igniter/db/provider/schema'
import { ColumnDef } from '@igniter/ui/components/table'
import {
  FilterGroup,
  SortOption,
} from '@igniter/ui/components/DataTable/index'
import {CsvColumnDef} from "@igniter/ui/lib/csv";


export const columns: Array<ColumnDef<AddressGroupWithDetails> & CsvColumnDef<AddressGroupWithDetails>> = [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'relayMiner',
    header: 'Relay Miner',
    cell: ({ row }) => {
      const rm = row.getValue('relayMiner') as RelayMiner
      return `${rm.name} (${rm.identity})` || '-'
    },
  },
  {
    accessorKey: 'addressGroupServices',
    header: 'Services',
    meta: { headerAlign: 'center' },
    cell: ({ row }) => {
      const addressGroupServices = row.getValue('addressGroupServices') as AddressGroupWithDetails['addressGroupServices']
      const count = addressGroupServices?.length ?? 0

      return (
        <span className="flex justify-center text-slightly-muted-foreground">
          {count > 0 ? `${count} service${count !== 1 ? 's' : ''}` : '-'}
        </span>
      )
    },
  },
  {
    accessorKey: 'private',
    header: 'Private',
    cell: ({ row }) => {
      const privateAddressGroup = row.getValue('private') as boolean
      return privateAddressGroup ? 'Private' : 'Public'
    },
  },
  {
    accessorKey: 'keysCount',
    header: 'Keys',
    cell: ({ row }) => {

      const keysCount = row.getValue('keysCount') as number | undefined
      return keysCount ? `${keysCount} keys` : 'No keys'
    },
  },
  {
    accessorKey: 'linkedAddresses',
    header: 'Linked Addresses',
    cell: ({ row }) => {
      const linkedAddresses = row.getValue('linkedAddresses') as string[]
      return linkedAddresses && linkedAddresses.length > 0 ? `${linkedAddresses.length} Linked Addresses` : 'No Linked Addresses'
    },
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated At',
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const updatedAt = new Date(row.getValue('updatedAt'))
      return (
        <span className="font-mono text-slightly-muted-foreground flex justify-center gap-2">
          {updatedAt.toLocaleString()}
        </span>
      )
    },
  },
]

export const sorts: Array<Array<SortOption<AddressGroupWithDetails>>> = [
  [
    {
      label: 'Most Recent',
      column: 'updatedAt',
      direction: 'desc',
      isDefault: true,
    },
  ],
]

export const filters: Array<FilterGroup<AddressGroupWithDetails>> = [
  {
    group: 'visibility',
    items: [
      [{ label: 'All', value: '', column: 'private', isDefault: true }],
      [
        { label: 'Private', value: true, column: 'private' },
        { label: 'Public', value: false, column: 'private' },
      ],
    ],
  },
]

