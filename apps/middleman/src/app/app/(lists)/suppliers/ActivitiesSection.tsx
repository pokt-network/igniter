'use client'

import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { GetPendingState } from '@/actions/Pending'
import Address from '@igniter/ui/components/Address'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import Amount from '@igniter/ui/components/Amount'
import { amountToPokt } from '@igniter/ui/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@igniter/ui/components/table'
import type { PendingStateSerialized, PendingOperationSerialized } from '@/lib/pending/derivePendingState'

function hasPendingOrLinger(state: PendingStateSerialized | undefined): boolean {
  if (!state) return false
  return (state.pendingOperations?.length ?? 0) > 0
}

function pendingCount(state: PendingStateSerialized | undefined): number {
  if (!state) return 0
  return Object.keys(state.byOperator).length
}

// Status-aware label and color per design spec:
// pending+stake → "Staking…" yellow, pending+unstake → "Unstaking…" yellow
// success+stake → "Staked" green, success+unstake → "Unstaked" green
// failure → "Failed" red
function getStatusLabel(op: PendingOperationSerialized): string {
  if (op.status === 'failure') return 'Failed'
  if (op.status === 'success') {
    return op.kind === 'stake' ? 'Staked' : 'Unstaked'
  }
  return op.kind === 'stake' ? 'Staking…' : 'Unstaking…'
}

function getStatusClass(op: PendingOperationSerialized): string {
  if (op.status === 'failure') return 'text-red-400'
  if (op.status === 'success') return 'text-emerald-400'
  return 'text-yellow-400'
}

const DASH = '—'

const HEAD_CLASS = 'text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4'

// Tx Hash column needs a stable width so the "—" placeholder reserves the same
// horizontal space the rendered <TransactionHash> (truncated mono "0x12345...abcde"
// + gap + copy icon) will occupy. This prevents a column resize / neighbor shift
// when the hash populates late (after broadcast). Applied to header + cell.
const TX_HASH_COL_CLASS = 'min-w-[12rem] w-[12rem]'

export default function ActivitiesSection() {
  const { data: pendingState } = useQuery({
    queryKey: ['pendingState'],
    queryFn: GetPendingState,
    refetchInterval: (q) => (hasPendingOrLinger(q.state.data) ? 7000 : false),
  })

  const rows = useMemo(() => {
    return pendingState?.pendingOperations ?? []
  }, [pendingState])

  const count = pendingCount(pendingState)

  // Render nothing when no pending and no recently-settled rows.
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {/* Section heading — matches RecentChanges / Services Overview style.
          Badge shows PENDING count only; settled-linger rows don't inflate it. */}
      <h3 className="text-lg font-semibold">
        In progress
        {count > 0 && (
          <span className="text-sm font-normal text-text-tertiary ml-2">· {count}</span>
        )}
      </h3>

      {/* Hand-built using the shared Table primitives (the same ones DataTable
          renders internally) + DataTable's exact header-cell classes. DataTable's
          own toolbar + pagination chrome would still render with no props, so we
          reuse the Table primitives directly for a compact, chrome-free strip that
          is visually identical to our tables. ~5 rows then internal scroll. */}
      <Table containerClassName="max-h-[260px]">
        <TableHeader>
          <TableRow className="bg-transparent">
            {/* Column order: Tx Hash · Submitted · Supplier · Owner · Provider · Amount · Op Funds · Status */}
            <TableHead className={clsx(HEAD_CLASS, TX_HASH_COL_CLASS)}>Tx Hash</TableHead>
            <TableHead className={HEAD_CLASS}>Submitted</TableHead>
            <TableHead className={HEAD_CLASS}>Supplier</TableHead>
            <TableHead className={HEAD_CLASS}>Owner</TableHead>
            <TableHead className={HEAD_CLASS}>Provider</TableHead>
            <TableHead className={clsx(HEAD_CLASS, 'text-right')}>Amount</TableHead>
            <TableHead className={clsx(HEAD_CLASS, 'text-right')}>Op Funds</TableHead>
            <TableHead className={clsx(HEAD_CLASS, 'text-center')}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const statusLabel = getStatusLabel(row)
            const statusClass = getStatusClass(row)
            const submittedStr = row.createdAt
              ? new Date(row.createdAt).toLocaleString()
              : null

            return (
              <TableRow key={row.operatorAddress}>
                {/* Tx Hash: stable min-width; "—" when null */}
                <TableCell className={TX_HASH_COL_CLASS}>
                  <div className="flex items-center min-h-[1.5rem]">
                    {row.hash ? <TransactionHash hash={row.hash} /> : <span>{DASH}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-slightly-muted-foreground">
                    {submittedStr ?? DASH}
                  </span>
                </TableCell>
                <TableCell>
                  <Address address={row.operatorAddress} />
                </TableCell>
                <TableCell>
                  {row.ownerAddress ? <Address address={row.ownerAddress} /> : DASH}
                </TableCell>
                <TableCell>
                  <span className="text-slightly-muted-foreground">
                    {row.providerName ?? DASH}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {row.stakeAmountUpokt != null ? (
                    <Amount value={amountToPokt(row.stakeAmountUpokt)} />
                  ) : (
                    DASH
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.opFundsUpokt != null ? (
                    <Amount value={amountToPokt(row.opFundsUpokt)} />
                  ) : (
                    DASH
                  )}
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
