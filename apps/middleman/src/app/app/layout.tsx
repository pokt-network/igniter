'use client'

import React, { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { AcknowledgeChanges, GetUnacknowledgedChanges } from '@/actions/SupplierChanges'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { Button } from '@igniter/ui/components/button'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotifications()
  const router = useRouter()
  const queryClient = useQueryClient()
  const notifiedBatchesRef = useRef<Set<string>>(new Set())

  const { data: unacknowledgedChanges } = useQuery({
    queryKey: ['unacknowledged-supplier-changes'],
    queryFn: GetUnacknowledgedChanges,
    refetchInterval: 60000,
  })

  useEffect(() => {
    if (!unacknowledgedChanges?.length) return

    // Group by batchId
    const batches = new Map<string, typeof unacknowledgedChanges>()
    for (const change of unacknowledgedChanges) {
      const existing = batches.get(change.batchId) ?? []
      existing.push(change)
      batches.set(change.batchId, existing)
    }

    for (const [batchId, changes] of batches) {
      if (notifiedBatchesRef.current.has(batchId)) continue
      notifiedBatchesRef.current.add(batchId)

      const providerName = changes[0]?.providerName ?? 'Your provider'
      const changeIds = changes.map((c) => c.id)

      // A node "completed staking" when its first active services landed (a service_added
      // flagged initialStake = active services went 0 → ≥1). Anything else is a genuine
      // config change (drift) — services/rev-share edited on an already-staked supplier.
      const completedNodeIds = new Set(
        changes
          .filter(
            (c) =>
              c.changeType === 'service_added' &&
              (c.newValue as { initialStake?: boolean } | null)?.initialStake,
          )
          .map((c) => c.nodeId),
      )
      const configNodeIds = new Set(
        changes.map((c) => c.nodeId).filter((id) => !completedNodeIds.has(id)),
      )
      const completedCount = completedNodeIds.size
      const configCount = configNodeIds.size
      const onlyCompleted = completedCount > 0 && configCount === 0

      addNotification({
        id: `supplier-changes-${batchId}`,
        type: onlyCompleted ? 'success' : 'warning',
        showTypeIcon: true,
        title: onlyCompleted
          ? 'Stake Completed'
          : completedCount > 0
            ? 'Supplier Updates'
            : 'Supplier Configuration Changed',
        content: (
          <span className="flex flex-col gap-0.5">
            {completedCount > 0 && (
              <p className="text-sm">
                <strong>{providerName}</strong> completed staking for{' '}
                <strong>{completedCount}</strong> of your supplier{completedCount > 1 ? 's' : ''}.
              </p>
            )}
            {configCount > 0 && (
              <p className="text-sm">
                <strong>{providerName}</strong> updated configuration for{' '}
                <strong>{configCount}</strong> of your supplier{configCount > 1 ? 's' : ''} — services or rev share may have changed.
              </p>
            )}
          </span>
        ),
        onDismiss: async () => {
          try {
            await AcknowledgeChanges(changeIds)
            await queryClient.invalidateQueries({ queryKey: ['unacknowledged-supplier-changes'] })
            await queryClient.invalidateQueries({ queryKey: ['recent-supplier-changes'] })
          } catch (err) {
            // Persisting the acknowledgement failed (auth/DB/network). The change is still
            // unacknowledged in the DB, so drop it from the seen-set to let the next 60s poll
            // re-surface the banner instead of silently losing it for the rest of the session.
            notifiedBatchesRef.current.delete(batchId)
            console.error('Failed to acknowledge supplier changes on dismiss', err)
          }
        },
        actions: [
          (_notification, removeNotification) => (
            <Button
              onClick={() => {
                router.push(`/app/suppliers?highlightBatch=${batchId}`)
                removeNotification()
              }}
            >
              View Details
            </Button>
          ),
        ],
      })
    }
  }, [unacknowledgedChanges])

  return <>{children}</>
}
