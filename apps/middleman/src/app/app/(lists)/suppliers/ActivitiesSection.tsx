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
import type { PendingStateSerialized } from '@/lib/pending/derivePendingState'

function hasPending(state: PendingStateSerialized | undefined): boolean {
  if (!state) return false
  return (state.pendingOperations?.length ?? 0) > 0 ||
    Object.keys(state.byOperator).length > 0
}

// Mirror the provider transactions table colored-text status idiom
// (apps/provider/.../transactions/table/columns.tsx StatusStyles/StatusLabels).
// In-progress = yellow, capitalized, NOT uppercase, NOT a pill.
const IN_PROGRESS_STATUS_STYLE = 'text-yellow-400'

const DASH = '—'

const HEAD_CLASS = 'text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4'

export default function ActivitiesSection() {
  const { data: pendingState } = useQuery({
    queryKey: ['pendingState'],
    queryFn: GetPendingState,
    refetchInterval: (q) => (hasPending(q.state.data) ? 7000 : false),
  })

  const rows = useMemo(() => {
    return pendingState?.pendingOperations ?? []
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
            <TableHead className={HEAD_CLASS}>Supplier</TableHead>
            <TableHead className={HEAD_CLASS}>Owner</TableHead>
            <TableHead className={HEAD_CLASS}>Provider</TableHead>
            <TableHead className={clsx(HEAD_CLASS, 'text-right')}>Amount</TableHead>
            <TableHead className={HEAD_CLASS}>Tx Hash</TableHead>
            <TableHead className={HEAD_CLASS}>Submitted</TableHead>
            <TableHead className={clsx(HEAD_CLASS, 'text-center')}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const statusLabel = row.kind === 'stake' ? 'Staking…' : 'Unstaking…'
            const submittedStr = row.createdAt
              ? new Date(row.createdAt).toLocaleString()
              : null

            return (
              <TableRow key={row.operatorAddress}>
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
                <TableCell>
                  {row.hash ? <TransactionHash hash={row.hash} /> : DASH}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-slightly-muted-foreground">
                    {submittedStr ?? DASH}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={clsx('flex justify-center font-medium', IN_PROGRESS_STATUS_STYLE)}>
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
