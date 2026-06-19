'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { Button } from '@igniter/ui/components/button'
import {
  ListUnviewedNotificationEvents,
  MarkNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import type { NotificationEvent } from '@igniter/db/provider/schema'
import { NOTIFICATION_EVENT_LABELS, NOTIFICATION_EVENT_SEVERITY } from '@/lib/constants'

function eventContent(event: NotificationEvent): string {
  const label = NOTIFICATION_EVENT_LABELS[event.type as keyof typeof NOTIFICATION_EVENT_LABELS] ?? event.type
  const meta = event.metadata

  let detail = ''
  if (meta && 'addresses' in meta) {
    const n = meta.addresses.length
    detail = `${n} supplier${n !== 1 ? 's' : ''} affected`
  } else if (meta && 'byReason' in meta) {
    const succeeded = Object.values(meta.byReason).reduce((a, r) => a + r.succeeded.length, 0)
    const failed = Object.values(meta.byReason).reduce((a, r) => a + r.failed.length, 0)
    detail = `${succeeded} succeeded, ${failed} failed`
  } else if (meta && 'inserted' in meta) {
    const changes = meta.inserted + meta.updated + meta.disabled
    detail = `${changes} change${changes !== 1 ? 's' : ''}`
  }

  return detail ? `${label} — ${detail}` : label
}

/**
 * Invisible bridge — loads unviewed notification events and injects them
 * into the existing NotificationsProvider context. Renders nothing.
 */
export default function NotificationEventsBridge() {
  const { addNotification } = useNotifications()
  const router = useRouter()
  const queryClient = useQueryClient()
  const shownIds = useRef<Set<string>>(new Set())

  const { data: events = [] } = useQuery({
    queryKey: ['unviewed-notification-events'],
    queryFn: async () => {
      const result = await ListUnviewedNotificationEvents()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    refetchInterval: 60000,
  })

  useEffect(() => {
    events.forEach((event, index) => {
      if (shownIds.current.has(event.uuid)) return
      shownIds.current.add(event.uuid)

      addNotification({
        id: event.uuid,
        type: NOTIFICATION_EVENT_SEVERITY[event.type as keyof typeof NOTIFICATION_EVENT_SEVERITY] ?? 'info',
        showTypeIcon: true,
        content: eventContent(event),
        actions: [
          (_notification, remove) => (
            <Button
              key="view"
              size="sm"
              onClick={async () => {
                remove()
                await MarkNotificationEventsViewed([event.id])
                queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
                queryClient.invalidateQueries({ queryKey: ['notification-events'] })
                router.push(`/admin/notifications?uuid=${event.uuid}`)
              }}
            >
              View
            </Button>
          ),
        ],
      })
    })
  }, [events])

  return null
}
