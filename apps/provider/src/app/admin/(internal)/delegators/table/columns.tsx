'use client'

import type { Delegator } from '@igniter/db/provider/schema'
import { ColumnDef } from '@igniter/ui/components/table'
import { CopyIcon } from '@igniter/ui/assets'
import { useState } from 'react'
import { UpdateDelegator } from '@/actions/Delegators'
import { Button } from '@igniter/ui/components/button'
import {
  FilterGroup,
  SortOption,
} from '@igniter/ui/components/DataTable/index'
import {CsvColumnDef} from "@igniter/ui/lib/csv";

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
            onClick={() => navigator.clipboard.writeText(identity)}
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
    cell: ({ row }) => {
      const delegator = row.original
      const [isEnabled, setIsEnabled] = useState(delegator.enabled)
      const [isUpdating, setUpdating] = useState(false)

      const handleToggle = async () => {
        setUpdating(true)
        try {
          const result = await UpdateDelegator(delegator.identity, { enabled: !isEnabled })
          if (!result.success) {
            throw new Error(result.error.message)
          }
          setIsEnabled(!isEnabled)
        } catch (error) {
          console.error('Error updating delegator status:', error)
        } finally {
          setUpdating(false)
        }
      }

      if (isUpdating) return (
        <div className="flex items-center justify-end px-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
        </div>
      )

      return (
        <div className="flex items-center justify-end px-4">
          <Button
            className="bg-slate-2 border-0"
            variant={'outline'}
            onClick={handleToggle}
          >
            {isEnabled ? 'Disable' : 'Enable'}
          </Button>
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
