'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isInternalPath } from '@igniter/commons/utils'
import { NotificationBell, type BellNotification } from '@igniter/ui/components/NotificationBell/index'
import {
  ListUnviewedNotificationEvents,
  CountUnviewedNotificationEvents,
  MarkNotificationEventsViewed,
  MarkAllNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import { notify, sessionMessages, useSessionMessages } from '@igniter/ui/lib/sessionMessages'
import { bellCardContent } from '@/lib/notificationEvents'
import { getLogger } from '@igniter/logger'

const log = getLogger(['middleman', 'NotificationBellFeed'])

/**
 * Topbar bell + unread badge for the middleman. Reads the per-wallet
 * notification_events feed; nothing appears over the page until the bell is
 * clicked, and an event is only marked viewed when its ✕ is used.
 *
 * Hidden on the portal/auth routes (same gate as the sidebar); everywhere else
 * the bell is always mounted, so the badge is the single place unread count is
 * reported.
 */
export default function NotificationBellFeed() {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const internal = isInternalPath(pathname)
  // Client-side failures (a rejected save, a failed channel test) live only for
  // this session and have no row in notification_events — they are merged in
  // ahead of the server feed rather than fetched.
  const localMessages = useSessionMessages(internal)

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-count'] })
    queryClient.invalidateQueries({ queryKey: ['notification-events'] })
  }, [queryClient])

  const { data: events = [] } = useQuery({
    queryKey: ['unviewed-notification-events'],
    queryFn: async () => {
      const res = await ListUnviewedNotificationEvents()
      return res.success ? res.data : []
    },
    // Matches the provider bell's cadence so a fresh event bumps the badge within
    // seconds. Foreground only (no refetchIntervalInBackground): a delegator's
    // events follow their own actions in this tab, so polling a backgrounded tab
    // would only add load.
    refetchInterval: 15000,
    enabled: internal,
  })

  // Separate from the list: the list is capped at 6 server-side, so its length
  // would under-report the badge once more than 6 events are unread.
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unviewed-notification-count'],
    queryFn: async () => {
      const res = await CountUnviewedNotificationEvents()
      return res.success ? res.data : 0
    },
    refetchInterval: 15000,
    enabled: internal,
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
      events.map((event) => {
        const card = bellCardContent(event.type, (event.metadata ?? {}) as Record<string, unknown>)

        return {
          uuid: event.uuid,
          severity: card.severity,
          title: card.title,
          description: card.description,
          createdAt: event.createdAt,
          onDismiss: async () => {
            try {
              const res = await MarkNotificationEventsViewed([event.id])
              if (!res.success) throw new Error(res.error.message)
            } catch (err) {
              log.error('failed to mark notification event viewed', { eventId: event.id, error: err })
              // Refetch so the card comes back rather than silently disappearing
              // for the rest of the session, and rethrow so the bell re-expands it.
              invalidate()
              throw err
            }
            invalidate()
          },
          onOpen: card.href ? () => router.push(card.href!) : undefined,
          // Not "View details": this lands on the supplier the event is about
          // (Recent Changes, batch expanded), not on a notification detail —
          // middleman has no such view. Provider's bell does open one, so only
          // that side says "details".
          openLabel: 'View supplier',
        } satisfies BellNotification
      }),
    [events, invalidate, router],
  )

  const notifications = useMemo(
    () => [...localNotifications, ...eventNotifications],
    [localNotifications, eventNotifications],
  )

  if (!internal) return null

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
          const res = await MarkAllNotificationEventsViewed()
          if (!res.success) throw new Error(res.error.message)
          // Only after the server half landed. Client-side messages are
          // session-scoped with nothing to restore from, so clearing them first
          // would destroy an unread failure the user had not opened yet — and
          // then report that nothing was marked.
          sessionMessages.dismissAll()
        } catch (err) {
          log.error('failed to mark all notification events viewed', { error: err })
          notify.error('Could not mark notifications as read.', {
            id: 'mark-all-read-error',
            description: err instanceof Error ? err.message : undefined,
          })
        }
        invalidate()
      }}
      onViewAll={() => router.push('/app/notifications')}
    />
  )
}
