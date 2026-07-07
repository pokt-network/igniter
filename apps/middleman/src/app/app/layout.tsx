'use client'

import React, { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  ListUnviewedNotificationEvents,
  MarkNotificationEventsViewed,
  GetNotificationPreferences,
} from '@/actions/NotificationChannels'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { Button } from '@igniter/ui/components/button'
import { EVENT_LABELS, SUPPLIER_TYPES, describeEvent } from '@/lib/notificationEvents'

// Single source of truth for the in-app header feed: the per-wallet
// notification_events store. Every event the user is subscribed to (supplier
// changes, transaction outcomes, import results) surfaces here and — for users
// with channels — is also delivered externally. (The detailed, acknowledge-based
// supplier-change view still lives on the Suppliers page / node detail.)
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotifications()
  const router = useRouter()
  const queryClient = useQueryClient()
  const notifiedRef = useRef<Set<number>>(new Set())

  const { data: prefs } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await GetNotificationPreferences()
      return res.success ? res.data : { inAppFeedEnabled: true }
    },
  })

  const { data: events } = useQuery({
    queryKey: ['unviewed-notification-events'],
    queryFn: async () => {
      const res = await ListUnviewedNotificationEvents()
      return res.success ? res.data : []
    },
    refetchInterval: 60000,
  })

  useEffect(() => {
    // Respect the per-user in-app feed toggle (default on). Wait until prefs are
    // known — otherwise a user who disabled the feed gets a flash of toasts on
    // load if the events query resolves before the prefs query.
    if (prefs === undefined || prefs.inAppFeedEnabled === false || !events?.length) return
    for (const ev of events) {
      if (notifiedRef.current.has(ev.id)) continue
      notifiedRef.current.add(ev.id)

      const meta = (ev.metadata ?? {}) as Record<string, unknown>
      const outcome = typeof meta.outcome === 'string' ? meta.outcome : undefined
      const isSupplier = SUPPLIER_TYPES.has(ev.type)
      const isFailure = outcome === 'failure' || outcome === 'failed'
      const isSuccess = outcome === 'success'
      const batchId = typeof meta.batchId === 'string' ? meta.batchId : undefined
      // A supplier event carrying outcome:'success' (a first stake) is a positive
      // event, not config drift — show it green with a dedicated label.
      const label = isSuccess && isSupplier ? 'Stake Completed' : EVENT_LABELS[ev.type] ?? 'Notification'

      addNotification({
        id: `notif-event-${ev.id}`,
        type: isFailure ? 'error' : isSuccess ? 'success' : isSupplier ? 'warning' : 'success',
        showTypeIcon: true,
        // The Notifications context renders `content` only (not `title`), so the
        // label is folded into content as a heading above the description.
        title: label,
        content: (
          <span className="flex flex-col gap-0.5 text-sm">
            <strong>{label}</strong>
            <span>{describeEvent(ev.type, meta)}</span>
          </span>
        ),
        onDismiss: async () => {
          try {
            await MarkNotificationEventsViewed([ev.id])
            await queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
          } catch (err) {
            // Marking viewed failed — drop from the seen-set so the next poll re-surfaces it.
            notifiedRef.current.delete(ev.id)
            console.error('Failed to mark notification event viewed', err)
          }
        },
        actions: isSupplier
          ? [
              (_notification, removeNotification) => (
                <Button
                  onClick={() => {
                    // Deep-link to the batch so RecentChanges highlights/expands
                    // it; fall back to the plain list if no batch id is present.
                    router.push(batchId ? `/app/suppliers?highlightBatch=${batchId}` : '/app/suppliers')
                    removeNotification()
                  }}
                >
                  View Details
                </Button>
              ),
            ]
          : undefined,
      })
    }
  }, [events, prefs])

  return <>{children}</>
}
