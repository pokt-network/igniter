'use client'

import type { Delegator } from '@igniter/db/provider/schema'
import { ColumnDef } from '@igniter/ui/components/table'
import { CopyIcon } from '@igniter/ui/assets'
import { useState } from 'react'
import { UpdateDelegator } from '@/actions/Delegators'
import { Switch } from '@igniter/ui/components/switch'
import {
  FilterGroup,
  SortOption,
} from '@igniter/ui/components/DataTable/index'
import {CsvColumnDef} from "@igniter/ui/lib/csv";
import { copyToClipboard } from "@igniter/ui/lib/utils";

export const columns: Array<ColumnDef<Delegator> & CsvColumnDef<Delegator>> = [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'identity',
    header: 'Identity',
    cell: ({ row }) => {

      const identity = row.original.identity
      const shortenedIdentity = `${identity.slice(0, 6)}...${identity.slice(-6)}`

      return (
        <div className="flex items-center space-x-2">
          <span>{shortenedIdentity}</span>
          <button
            onClick={() => copyToClipboard(identity)}
            className="p-1 rounded"
            title="Copy to clipboard"
          >
            <CopyIcon/>
          </button>
        </div>
      )
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Created At',
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const createdAt = new Date(row.getValue('createdAt'))
      return (
        <span className="font-mono text-slightly-muted-foreground flex justify-center gap-2">
          {createdAt.toLocaleString()}
        </span>
      )
    },
  },
  {
    id: 'enabled',
    header: 'Enabled',
    meta: { headerAlign: 'right' },
    cell: ({ row }) => {
      const delegator = row.original
      const [isEnabled, setIsEnabled] = useState(delegator.enabled)
      const [isUpdating, setUpdating] = useState(false)

      if (isUpdating) return (
        <div className="flex items-center justify-end px-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
        </div>
      )

      return (
        <div className="flex items-center justify-end gap-2">
          <label className="flex items-center justify-end cursor-pointer">
            <Switch
              checked={isEnabled}
              onCheckedChange={async (checked) => {
                setUpdating(true)
                try {
                  const result = await UpdateDelegator(delegator.identity, { enabled: checked })
                  if (!result.success) throw new Error(result.error.message)
                  setIsEnabled(checked)
                } catch (error) {
                  console.error('Error updating delegator status:', error)
                } finally {
                  setUpdating(false)
                }
              }}
            />
          </label>
        </div>
      )
    },
  },
]

export const sorts: Array<Array<SortOption<Delegator>>> = [
  [
    {
      label: 'Most Recent',
      column: 'createdAt',
      direction: 'desc',
      isDefault: true,
    },
  ],
]

export const filters: Array<FilterGroup<Delegator>> = [
  {
    group: 'state',
    items: [
      [{ label: 'All', value: '', column: 'enabled', isDefault: true }],
      [
        { label: 'Enabled', value: true, column: 'enabled' },
        { label: 'Disabled', value: false, column: 'enabled' },
      ],
    ],
  },
]
