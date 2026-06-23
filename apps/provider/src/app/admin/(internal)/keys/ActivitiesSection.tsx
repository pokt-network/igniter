'use client'

import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { GetKeysPendingState } from '@/actions/Transactions'
import { formatRelativeTime } from '@/lib/utils/time'
import Address from '@igniter/ui/components/Address'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@igniter/ui/components/table'
import type {
  PendingStateSerialized,
  PendingOperationSerialized,
} from '@/lib/pending/derivePendingState'

// PENDING-only count — recently-settled linger rows don't inflate the badge.
function pendingCount(state: PendingStateSerialized | undefined): number {
  if (!state) return 0
  return Object.keys(state.byKey).length
}

const TYPE_LABELS: Record<PendingOperationSerialized['kind'], string> = {
  stake: 'Stake',
  unstake: 'Unstake',
  return_funds: 'Return Funds',
}

// Status-aware label per design spec:
// pending+stake → "Staking…", pending+unstake → "Unstaking…", pending+return_funds → "Returning…"
// success+stake → "Staked", success+unstake → "Unstaked", success+return_funds → "Returned"
// failure → "Failed"
function getStatusLabel(op: PendingOperationSerialized): string {
  if (op.status === 'failure') return 'Failed'
  if (op.status === 'success') {
    if (op.kind === 'stake') return 'Staked'
    if (op.kind === 'unstake') return 'Unstaked'
    return 'Returned'
  }
  if (op.kind === 'stake') return 'Staking…'
  if (op.kind === 'unstake') return 'Unstaking…'
  return 'Returning…'
}

// amber for in-progress, slate for settled-unstake/return, green for staked, red for failed.
function getStatusClass(op: PendingOperationSerialized): string {
  if (op.status === 'failure') return 'text-red-400'
  if (op.status === 'success') {
    if (op.kind === 'stake') return 'text-emerald-400'
    return 'text-text-secondary'
  }
  return 'text-yellow-400'
}

const DASH = '—'

const HEAD_CLASS = 'text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4'

// Tx Hash column needs a stable width so the "—" placeholder reserves the same
// horizontal space the rendered <TransactionHash> will occupy — prevents a column
// resize / neighbor shift when the hash populates late (after broadcast).
const TX_HASH_COL_CLASS = 'min-w-[12rem] w-[12rem]'

export default function ActivitiesSection() {
  const { data: pendingState } = useQuery({
    queryKey: ['keys-pending-state'],
    queryFn: async () => {
      const res = await GetKeysPendingState()
      return res.success ? res.data : { byKey: {}, pendingOperations: [] }
    },
    // Poll every 4s, always — matching the keys-list companion query (['keys-pending-unstake'])
    // so this section discovers new activity at the SAME cadence as the list (otherwise a
    // slower idle interval makes the list update first and this section lag behind). Catches
    // activity the operator did NOT initiate here too (middleman stake/unstake, external
    // pocketd unstake via the status sweep). The query is light and renders nothing when idle.
    refetchInterval: 4000,
  })

  const rows = useMemo(() => {
    return pendingState?.pendingOperations ?? []
  }, [pendingState])

  const count = pendingCount(pendingState)

  // Render nothing when no pending and no recently-settled rows — section only
  // appears during activity.
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {/* Badge shows PENDING count only; settled-linger rows don't inflate it. */}
      <h3 className="text-lg font-semibold">
        In progress
        {count > 0 && (
          <span className="text-sm font-normal text-text-tertiary ml-2">· {count}</span>
        )}
      </h3>

      {/* Compact, chrome-free strip built from the shared Table primitives (no
          DataTable toolbar/pagination). ~5 rows then internal scroll. */}
      <Table containerClassName="max-h-[260px]">
        <TableHeader>
          <TableRow className="bg-transparent">
            {/* Column order: Tx Hash · Submitted · Supplier · Type · Status */}
            <TableHead className={clsx(HEAD_CLASS, TX_HASH_COL_CLASS)}>Tx Hash</TableHead>
            <TableHead className={HEAD_CLASS}>Submitted</TableHead>
            <TableHead className={HEAD_CLASS}>Supplier</TableHead>
            <TableHead className={HEAD_CLASS}>Type</TableHead>
            <TableHead className={clsx(HEAD_CLASS, 'text-center')}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const statusLabel = getStatusLabel(row)
            const statusClass = getStatusClass(row)

            return (
              <TableRow key={row.keyAddress}>
                {/* Tx Hash: stable min-width; "—" when null (before broadcast) */}
                <TableCell className={TX_HASH_COL_CLASS}>
                  <div className="flex items-center min-h-[1.5rem]">
                    {row.hash ? <TransactionHash hash={row.hash} /> : <span>{DASH}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-slightly-muted-foreground">
                    {formatRelativeTime(row.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <Address address={row.keyAddress} />
                </TableCell>
                <TableCell>
                  <span className="text-slightly-muted-foreground">
                    {TYPE_LABELS[row.kind]}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={clsx('flex justify-center font-medium', statusClass)}>
                    {statusLabel}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
