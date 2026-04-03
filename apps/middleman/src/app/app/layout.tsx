'use client'

import React, { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { GetUnacknowledgedChanges } from '@/actions/SupplierChanges'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { Button } from '@igniter/ui/components/button'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotifications()
  const router = useRouter()
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

      const affectedNodeIds = new Set(changes.map((c) => c.nodeId))
      const providerName = changes[0]?.providerName ?? 'Your provider'

      addNotification({
        id: `supplier-changes-${batchId}`,
        type: 'warning',
        showTypeIcon: true,
        title: 'Supplier Configuration Changed',
        content: (
          <p className="text-sm">
            <strong>{providerName}</strong> updated configuration for{' '}
            <strong>{affectedNodeIds.size}</strong> of your supplier{affectedNodeIds.size > 1 ? 's' : ''} — services or rev share may have changed.
          </p>
        ),
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
