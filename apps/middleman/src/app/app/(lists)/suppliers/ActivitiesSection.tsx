'use client'

import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GetPendingState } from '@/actions/Pending'
import { GetUserTransactions } from '@/actions/Transactions'
import { Badge } from '@igniter/ui/components/badge'
import Address from '@igniter/ui/components/Address'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import { Skeleton } from '@igniter/ui/components/skeleton'
import { TransactionType, TransactionStatus } from '@igniter/db/middleman/enums'
import type { PendingStateSerialized } from '@/lib/pending/derivePendingState'

function hasPending(state: PendingStateSerialized | undefined): boolean {
  if (!state) return false
  return Object.keys(state.byOperator).length > 0 || state.pendingStakeOperators.length > 0
}

function pendingCount(state: PendingStateSerialized): number {
  // Dedupe by operatorAddress: pendingStakeOperators addresses may also appear in byOperator
  const addresses = new Set<string>([
    ...Object.keys(state.byOperator),
    ...state.pendingStakeOperators.map((p) => p.operatorAddress),
  ])
  return addresses.size
}

function formatDate(dateStr: string | null | undefined | Date): string {
  if (!dateStr) return '—'
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  [TransactionStatus.Pending]: 'warning',
  [TransactionStatus.Success]: 'success',
  [TransactionStatus.Failure]: 'destructive',
  [TransactionStatus.NotExecuted]: 'secondary',
}

const STATUS_LABEL: Record<string, string> = {
  [TransactionStatus.Pending]: 'Pending',
  [TransactionStatus.Success]: 'Success',
  [TransactionStatus.Failure]: 'Failed',
  [TransactionStatus.NotExecuted]: 'Not Executed',
}

const SUPPLIER_TX_TYPES = new Set<string>([
  TransactionType.Stake,
  TransactionType.Unstake,
  TransactionType.Upstake,
])

const cardClasses =
  'rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4'

export default function ActivitiesSection() {
  const { data: pendingState, isLoading: pendingLoading } = useQuery({
    queryKey: ['pendingState'],
    queryFn: GetPendingState,
    refetchInterval: (q) => (hasPending(q.state.data) ? 7000 : false),
  })

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['user-transactions'],
    queryFn: GetUserTransactions,
    refetchInterval: 15000,
  })

  const recentTxs = useMemo(() => {
    if (!transactions) return []
    return transactions
      .filter((tx) => SUPPLIER_TX_TYPES.has(tx.type))
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTime - aTime
      })
      .slice(0, 20)
  }, [transactions])

  const pendingStakeOps = pendingState?.pendingStakeOperators ?? []

  const isLoading = pendingLoading || txLoading
  const totalPending = pendingState ? pendingCount(pendingState) : 0

  // Nothing to show
  if (!isLoading && totalPending === 0 && recentTxs.length === 0) return null

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Activities</h3>
        <div className={cardClasses}>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full !bg-[color:#383838] rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">Activities</h3>
        {totalPending > 0 && (
          <Badge variant="warning">
            {totalPending} pending
          </Badge>
        )}
      </div>

      <div className={cardClasses}>
        <div className="flex flex-col divide-y divide-[color:--divider]">
          {/* Pending stakes with no node row yet */}
          {pendingStakeOps.map((op) => (
            <div
              key={op.operatorAddress}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                <span className="text-sm text-text-secondary shrink-0">Stake</span>
                <Address address={op.operatorAddress} />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-text-tertiary">
                  {formatDate(op.createdAt)}
                </span>
                <Badge variant="warning">Staking…</Badge>
              </div>
            </div>
          ))}

          {/* Recent stake/unstake/upstake transactions */}
          {recentTxs.map((tx) => {
            const statusVariant = STATUS_VARIANT[tx.status] ?? 'secondary'
            const statusLabel = STATUS_LABEL[tx.status] ?? tx.status
            return (
              <div
                key={tx.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-text-secondary shrink-0">{tx.type}</span>
                  {tx.hash && <TransactionHash hash={tx.hash} />}
                  {tx.provider && (
                    <span className="text-xs text-text-tertiary truncate">
                      {tx.provider.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-text-tertiary">
                    {formatDate(tx.createdAt)}
                  </span>
                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                </div>
              </div>
            )
          })}

          {totalPending === 0 && recentTxs.length === 0 && (
            <p className="text-sm text-text-tertiary py-3">No recent supplier activity.</p>
          )}
        </div>
      </div>
    </div>
  )
}
