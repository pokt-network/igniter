'use client'

import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { GetPendingState } from '@/actions/Pending'
import Address from '@igniter/ui/components/Address'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@igniter/ui/components/table'
import type { PendingStateSerialized } from '@/lib/pending/derivePendingState'

function hasPending(state: PendingStateSerialized | undefined): boolean {
  if (!state) return false
  return Object.keys(state.byOperator).length > 0 || state.pendingStakeOperators.length > 0
}

// Mirror the provider transactions table colored-text status idiom
// (apps/provider/.../transactions/table/columns.tsx StatusStyles/StatusLabels).
// In-progress = yellow, capitalized, NOT uppercase, NOT a pill.
const IN_PROGRESS_STATUS_STYLE = 'text-yellow-400'

type RowItem = {
  key: string
  typeLabel: 'Stake' | 'Unstake'
  statusLabel: 'Staking…' | 'Unstaking…'
  operatorAddress: string
}

export default function ActivitiesSection() {
  const { data: pendingState } = useQuery({
    queryKey: ['pendingState'],
    queryFn: GetPendingState,
    refetchInterval: (q) => (hasPending(q.state.data) ? 7000 : false),
  })

  const rows = useMemo<RowItem[]>(() => {
    if (!pendingState) return []

    // Dedupe by operatorAddress; prefer unstake over stake.
    const map = new Map<string, RowItem>()

    for (const op of pendingState.pendingStakeOperators) {
      map.set(op.operatorAddress, {
        key: op.operatorAddress,
        typeLabel: 'Stake',
        statusLabel: 'Staking…',
        operatorAddress: op.operatorAddress,
      })
    }

    for (const [operator, entry] of Object.entries(pendingState.byOperator)) {
      if (entry.kind === 'unstake') {
        map.set(operator, {
          key: operator,
          typeLabel: 'Unstake',
          statusLabel: 'Unstaking…',
          operatorAddress: operator,
        })
      }
    }

    return Array.from(map.values())
  }, [pendingState])

  // Render nothing when idle.
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {/* Section heading — matches RecentChanges / Services Overview style */}
      <h3 className="text-lg font-semibold">
        In progress
        <span className="text-sm font-normal text-text-tertiary ml-2">· {rows.length}</span>
      </h3>

      {/* Hand-built using the shared Table primitives (the same ones DataTable
          renders internally) + DataTable's exact header-cell classes. DataTable's
          own toolbar + pagination chrome would still render with no props, so we
          reuse the Table primitives directly for a compact, chrome-free strip that
          is visually identical to our tables. ~5 rows then internal scroll. */}
      <Table containerClassName="max-h-[260px]">
        <TableHeader>
          <TableRow className="bg-transparent">
            <TableHead className="text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4">
              Type
            </TableHead>
            <TableHead className="text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4">
              Supplier
            </TableHead>
            <TableHead className="text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4 text-center">
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <span className="text-slightly-muted-foreground">{row.typeLabel}</span>
              </TableCell>
              <TableCell>
                <Address address={row.operatorAddress} />
              </TableCell>
              <TableCell>
                <span className={clsx('flex justify-center font-medium', IN_PROGRESS_STATUS_STYLE)}>
                  {row.statusLabel}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
