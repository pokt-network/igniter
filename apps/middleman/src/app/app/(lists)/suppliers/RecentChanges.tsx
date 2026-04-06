'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { GetRecentChanges, AcknowledgeChanges } from '@/actions/SupplierChanges'
import { GetNode } from '@/actions/Nodes'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'
import { Button } from '@igniter/ui/components/button'
import { CaretSmallIcon } from '@igniter/ui/assets'
import { Badge } from '@igniter/ui/components/badge'
import { SupplierChangeType } from '@igniter/db/middleman/enums'
import { clsx } from 'clsx'
import { Skeleton } from '@igniter/ui/components/skeleton'

const CHANGE_TYPE_LABEL: Record<string, string> = {
  [SupplierChangeType.ServiceAdded]: 'Service Added',
  [SupplierChangeType.ServiceRemoved]: 'Service Removed',
  [SupplierChangeType.RevShareChanged]: 'Rev Share Changed',
}

/**
 * Renders a change description with highlighted service IDs and percentages.
 * Patterns matched:
 *   "Service <serviceId> added/removed"
 *   "Your rev share for <serviceId> changed from <N>% to <N>%"
 */
function ChangeDescription({ change }: { change: ChangeRow }) {
  if (change.changeType === SupplierChangeType.ServiceAdded) {
    const revShare = (change.newValue as { revSharePercentage: number } | null)?.revSharePercentage
    return (
      <span className="text-sm text-text-primary">
        Service <Badge variant="outline" className="font-mono mx-0.5">{change.serviceId}</Badge> added
        {revShare !== undefined && (
          <> with <span className="font-mono font-medium text-green-400">{revShare}%</span> rev share</>
        )}
      </span>
    )
  }

  if (change.changeType === SupplierChangeType.ServiceRemoved) {
    const revShare = (change.previousValue as { revSharePercentage: number } | null)?.revSharePercentage
    return (
      <span className="text-sm text-text-primary">
        Service <Badge variant="outline" className="font-mono mx-0.5">{change.serviceId}</Badge> removed
        {revShare !== undefined && (
          <> (your rev share was <span className="font-mono font-medium text-red-400">{revShare}%</span>)</>
        )}
      </span>
    )
  }

  if (change.changeType === SupplierChangeType.RevShareChanged) {
    const prev = change.previousValue as { revSharePercentage: number } | null
    const next = change.newValue as { revSharePercentage: number } | null
    const oldPct = prev?.revSharePercentage
    const newPct = next?.revSharePercentage

    if (oldPct !== undefined && newPct !== undefined) {
      return (
        <span className="text-sm text-text-primary">
          Your rev share for{' '}
          <Badge variant="outline" className="font-mono mx-0.5">{change.serviceId}</Badge>
          {' '}changed from{' '}
          <span className="font-mono font-medium text-red-400">{oldPct}%</span>
          {' '}to{' '}
          <span className="font-mono font-medium text-green-400">{newPct}%</span>
        </span>
      )
    }

    return <span className="text-sm text-text-primary">{change.description}</span>
  }

  return <span className="text-sm text-text-primary">{change.description}</span>
}

const CHANGE_TYPE_COLOR: Record<string, string> = {
  [SupplierChangeType.ServiceAdded]: 'text-green-400 border-green-400/40',
  [SupplierChangeType.ServiceRemoved]: 'text-red-400 border-red-400/40',
  [SupplierChangeType.RevShareChanged]: 'text-yellow-400 border-yellow-400/40',
}

const CHANGE_TYPE_BORDER: Record<string, string> = {
  [SupplierChangeType.ServiceAdded]: 'border-l-green-400',
  [SupplierChangeType.ServiceRemoved]: 'border-l-red-400',
  [SupplierChangeType.RevShareChanged]: 'border-l-yellow-400',
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

type ChangeRow = Awaited<ReturnType<typeof GetRecentChanges>>['rows'][number]

interface BatchGroup {
  batchId: string
  providerName: string | null
  changeTypes: Set<string>
  serviceIds: Set<string>
  changes: ChangeRow[]
  supplierAddresses: Map<number, string> // nodeId -> address
  createdAt: Date
  hasUnread: boolean
}

function groupByBatch(rows: ChangeRow[]): BatchGroup[] {
  const map = new Map<string, BatchGroup>()

  for (const row of rows) {
    let group = map.get(row.batchId)
    if (!group) {
      group = {
        batchId: row.batchId,
        providerName: row.providerName,
        changeTypes: new Set(),
        serviceIds: new Set(),
        changes: [],
        supplierAddresses: new Map(),
        createdAt: new Date(row.createdAt),
        hasUnread: false,
      }
      map.set(row.batchId, group)
    }
    group.changeTypes.add(row.changeType)
    group.serviceIds.add(row.serviceId)
    group.changes.push(row)
    group.supplierAddresses.set(row.nodeId, row.nodeAddress)
    if (!row.acknowledgedAt) group.hasUnread = true
  }

  return Array.from(map.values())
}

function SupplierLink({ address }: { nodeId: number; address: string }) {
  const addItem = useAddItemToDetail()
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async () => {
    setIsLoading(true)
    try {
      const node = await GetNode(address)
      if (!node) return
      addItem({
        type: 'node',
        body: {
          id: node.id,
          address: node.address,
          ownerAddress: node.ownerAddress,
          status: node.status,
          stakeAmount: Number(node.stakeAmount),
          operationalFundsAmount: Number(node.balance.toString()),
          provider: node.provider ?? null,
          services: node.services ?? [],
          transactions: node.transactionsToNodes.map((t) => t.transaction).map((t) => ({
            id: t.id,
            type: t.type,
            status: t.status,
            createdAt: t.createdAt!,
            operations: JSON.parse(t.unsignedPayload).body.messages,
            hash: t.hash || '',
            estimatedFee: t.estimatedFee,
            consumedFee: t.consumedFee,
            provider: node.provider?.name || '',
            providerFee: t.providerFee,
            typeProviderFee: t.typeProviderFee,
          })),
        },
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={clsx(
        'inline-flex flex-row items-center justify-center gap-2 rounded-md border border-border-primary px-3 h-8',
        'hover:bg-muted/40 transition-colors cursor-pointer',
        'disabled:opacity-50 disabled:cursor-wait',
      )}
    >
      <span className="font-mono text-sm text-pink-1 flex items-center h-full">
        {address}
      </span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
        <path d="M4.5 9l3-3-3-3" />
      </svg>
    </button>
  )
}

function BatchRow({
  group,
  isHighlighted,
  initialExpanded,
}: {
  group: BatchGroup
  isHighlighted: boolean
  initialExpanded: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const [isAcknowledging, setIsAcknowledging] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (initialExpanded) setIsExpanded(true)
  }, [initialExpanded])

  const handleAcknowledge = async () => {
    setIsAcknowledging(true)
    try {
      const unreadIds = group.changes.filter((c) => !c.acknowledgedAt).map((c) => c.id)
      if (unreadIds.length > 0) {
        await AcknowledgeChanges(unreadIds)
        await queryClient.invalidateQueries({ queryKey: ['recent-supplier-changes'] })
        await queryClient.invalidateQueries({ queryKey: ['unacknowledged-supplier-changes'] })
      }
    } finally {
      setIsAcknowledging(false)
    }
  }

  const changeTypeSummary = Array.from(group.changeTypes).map((t) => CHANGE_TYPE_LABEL[t] ?? t)

  return (
    <div
      className={clsx(
        'rounded-lg border transition-colors',
        isHighlighted ? 'border-yellow-500/60 bg-yellow-500/5' : 'border-[color:--divider]',
        group.hasUnread && !isHighlighted && 'border-yellow-500/30',
      )}
    >
      {/* Batch header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <span className="flex items-center justify-center shrink-0">
          <CaretSmallIcon style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }} />
        </span>

        <div className="flex-1 min-w-0 flex items-center gap-3">
          <span className="text-sm font-medium truncate">
            {group.providerName ?? 'Unknown Provider'}
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {Array.from(group.changeTypes).map((type) => (
              <Badge
                key={type}
                variant="outline"
                className={clsx('text-xs', CHANGE_TYPE_COLOR[type])}
              >
                {CHANGE_TYPE_LABEL[type] ?? type}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-text-tertiary font-mono">
            {group.supplierAddresses.size} supplier{group.supplierAddresses.size > 1 ? 's' : ''}
          </span>
          <span className="text-xs text-text-tertiary">
            {formatRelativeTime(group.createdAt)}
          </span>
          {group.hasUnread && (
            <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[color:--divider] px-4 py-4 flex flex-col gap-4 bg-muted/10">
          {/* Change details */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-tertiary uppercase tracking-wider font-medium">Changes</p>
            {/* Deduplicate change descriptions — same description across multiple suppliers is the same change */}
            {Array.from(
              new Map(group.changes.map((c) => [`${c.changeType}-${c.serviceId}-${c.description}`, c])).values()
            ).map((change) => (
              <div
                key={`${change.changeType}-${change.serviceId}`}
                className={clsx(
                  'flex items-center gap-3 border-l-2 pl-3 py-1',
                  CHANGE_TYPE_BORDER[change.changeType],
                )}
              >
                <ChangeDescription change={change} />
              </div>
            ))}
          </div>

          {/* Affected suppliers */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
              Affected Suppliers
            </p>
            <div className="flex flex-wrap gap-2">
              {Array.from(group.supplierAddresses.entries()).map(([nodeId, address]) => (
                <SupplierLink key={nodeId} nodeId={nodeId} address={address} />
              ))}
            </div>
          </div>

          {/* Acknowledge button */}
          {group.hasUnread && (
            <div className="flex justify-end pt-1 border-t border-[color:--divider]">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                disabled={isAcknowledging}
                onClick={(e) => {
                  e.stopPropagation()
                  handleAcknowledge()
                }}
              >
                Mark as read
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RecentChanges() {
  const searchParams = useSearchParams()
  const highlightBatch = searchParams.get('highlightBatch')
  const [page, setPage] = useState(1)
  const pageSize = 10

  const { data, isLoading } = useQuery({
    queryKey: ['recent-supplier-changes', page],
    queryFn: () => GetRecentChanges(page, pageSize),
    refetchInterval: 60000,
  })

  const batches = useMemo(() => {
    if (!data?.rows) return []
    return groupByBatch(data.rows)
  }, [data?.rows])

  if (!isLoading && batches.length === 0) return null

  const cardClasses = 'rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4'

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Recent Changes</h3>
        <div className={cardClasses}>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full !bg-[color:#383838] rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Recent Changes</h3>

      <div className={cardClasses}>
        <div className="flex flex-col gap-2">
          {batches.map((group) => (
            <BatchRow
              key={group.batchId}
              group={group}
              isHighlighted={highlightBatch === group.batchId}
              initialExpanded={highlightBatch === group.batchId}
            />
          ))}
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[color:--divider]">
            <span className="text-xs text-text-tertiary">
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
