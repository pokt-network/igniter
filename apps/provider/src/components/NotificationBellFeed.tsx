'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { NotificationBell, type BellNotification } from '@igniter/ui/components/NotificationBell/index'
import {
  ListUnviewedNotificationEvents,
  CountUnviewedNotificationEvents,
  MarkNotificationEventsViewed,
  MarkAllNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import { notify, sessionMessages, useSessionMessages } from '@igniter/ui/lib/sessionMessages'
import { bellSeverity, eventDetail, eventTitle } from '@/lib/notificationBellFeed'
import { getLogger } from '@igniter/logger';

const log = getLogger(['provider', 'ui', 'NotificationBellFeed']);

/**
 * Topbar bell + unread badge for the provider. Polls the unviewed feed and the
 * unread count; nothing renders over the page until the operator opens the panel.
 * An event is only marked viewed when its ✕ is clicked (or via "Mark all as read").
 */
export default function NotificationBellFeed() {
  const router = useRouter()
  const queryClient = useQueryClient()
  // Client-side failures (a rejected delete, a failed channel test) live only for
  // this session and have no row in notification_events — they are merged in
  // ahead of the server feed rather than fetched.
  const localMessages = useSessionMessages()

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-count'] })
    queryClient.invalidateQueries({ queryKey: ['notification-events'] })
  }, [queryClient])

  const { data: events = [] } = useQuery({
    queryKey: ['unviewed-notification-events'],
    queryFn: async () => {
      const result = await ListUnviewedNotificationEvents()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    // Poll often enough that a freshly-created event bumps the badge within a few
    // seconds (60s felt broken). refetchIntervalInBackground keeps polling while this tab
    // is backgrounded — events frequently land while the operator is staking in the
    // middleman tab, so they should already be waiting when they switch back.
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  })

  // Separate from the list: the list is capped at 6 server-side, so its length
  // would under-report the badge once more than 6 events are unread.
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unviewed-notification-count'],
    queryFn: async () => {
      const result = await CountUnviewedNotificationEvents()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  })

  // Session messages first: they are the newest thing that happened, and they are
  // the direct result of something the user just did.
  const localNotifications = useMemo<Array<BellNotification>>(
    () =>
      localMessages.map((message) => ({
        uuid: message.id,
        severity: message.severity,
        title: message.title,
        description: message.description,
        createdAt: message.createdAt,
        // Purely client-side, so dismissal is a store delete — nothing to persist
        // and nothing that can fail.
        onDismiss: () => sessionMessages.dismiss(message.id),
      })),
    [localMessages],
  )

  const eventNotifications = useMemo<Array<BellNotification>>(
    () =>
      events.map((event) => ({
        uuid: event.uuid,
        severity: bellSeverity(event.type),
        title: eventTitle(event),
        description: eventDetail(event) || undefined,
        createdAt: event.createdAt,
        onDismiss: async () => {
          // The ✕ is the only thing that marks an event read; persist it or the
          // next poll re-surfaces the card.
          try {
            const result = await MarkNotificationEventsViewed([event.id])
            if (!result.success) throw new Error(result.error.message)
            invalidate()
          } catch (err) {
            log.error('Failed to mark notification event viewed on dismiss', { error: err })
            // Refetch so the card returns rather than silently disappearing for
            // the rest of the session, and rethrow so the bell re-expands it.
            invalidate()
            throw err
          }
        },
        onOpen: () => router.push(`/admin/notifications?uuid=${event.uuid}`),
        openLabel: 'View details',
      })),
    [events, invalidate, router],
  )

  const notifications = useMemo(
    () => [...localNotifications, ...eventNotifications],
    [localNotifications, eventNotifications],
  )

  return (
    <NotificationBell
      notifications={notifications}
      // Session messages are always in the list, so they count on top of the
      // server's unread total rather than being capped by the feed limit.
      unreadCount={unreadCount + localMessages.length}
      onMarkAllRead={async () => {
        try {
          // The action resolves with {success:false} rather than throwing, so
          // without this check a failed mark-all looked identical to a successful
          // one: the badge stayed, every card came back on the next poll, and
          // nothing said why. `onDismiss` above has always checked; this did not.
          const result = await MarkAllNotificationEventsViewed()
          if (!result.success) throw new Error(result.error.message)
          // Only after the server half landed. Client-side messages are
          // session-scoped with nothing to restore from, so clearing them first
          // would destroy an unread failure the user had not opened yet — and
          // then report that nothing was marked.
          sessionMessages.dismissAll()
        } catch (err) {
          log.error('Failed to mark all notification events viewed', { error: err })
          notify.error('Could not mark notifications as read.', {
            id: 'mark-all-read-error',
            description: err instanceof Error ? err.message : undefined,
          })
        }
        invalidate()
      }}
      onViewAll={() => router.push('/admin/notifications')}
    />
  )
}
