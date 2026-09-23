'use client'

import React from 'react'
import { CheckIcon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { NotificationHistory } from '@igniter/ui/components/NotificationChannels/NotificationHistory'
import type { NotificationHistoryEvent } from '@igniter/ui/components/NotificationChannels/NotificationHistory'
import {
  ListNotificationEvents,
  MarkNotificationEventsViewed,
  MarkAllNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import { notify } from '@igniter/ui/lib/sessionMessages'
import { EVENT_LABELS, describeEvent, eventSeverity } from '@/lib/notificationEvents'
import { NOTIFICATION_EVENT_TYPES } from '@igniter/db/middleman/enums'

// Event-type dropdown options for the history filter.
const EVENT_TYPE_OPTIONS = NOTIFICATION_EVENT_TYPES.map((t) => ({
  value: t,
  label: EVENT_LABELS[t] ?? t,
}))

// Middleman wrapper around the shared history table: wallet-scoped actions +
// middleman's event vocabulary. No detail drawer (provider-only), so a row click
// just marks the event read.
export function NotificationHistorySection() {
  const queryClient = useQueryClient()

  const invalidateViewed = () => {
    queryClient.invalidateQueries({ queryKey: ['notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-count'] })
  }

  const openEvent = (event: NotificationHistoryEvent) => {
    if (event.viewedAt) return
    void MarkNotificationEventsViewed([event.id])
      .then((res) => {
        if (!res.success) throw new Error(res.error.message)
        invalidateViewed()
      })
      .catch((err) => {
        // Same rule as the bell's ✕: a mark-read that did not persist has to say
        // so, or the row comes back unread and the click looks broken.
        notify.error('Could not mark this notification as read.', {
          id: `mark-read-error-${event.id}`,
          description: err instanceof Error ? err.message : undefined,
        })
        invalidateViewed()
      })
  }

  return (
    <NotificationHistory
      // Middleman's Discord/Telegram/email messages carry the event uuid and say
      // "Search for this ID in the Notifications page" (richMessage.ts), which
      // was impossible here until this was switched on.
      enableSearch
      eventTypeOptions={EVENT_TYPE_OPTIONS}
      onOpenEvent={openEvent}
      // Middleman has no detail drawer, so the row action marks the event read
      // and nothing else. It says that rather than showing the arrow, which
      // reads as "opens something" and left the click looking broken.
      itemActionIcon={<CheckIcon style={{ width: '16px', height: '16px' }} />}
      itemActionLabel="Mark as read"
      showItemAction={(event) => !event.viewedAt}
      labelFor={(type) => EVENT_LABELS[type] ?? 'Notification'}
      summaryFor={(type, metadata) =>
        describeEvent(type, (metadata ?? {}) as Record<string, unknown>)
      }
      severityFor={(type, metadata) =>
        eventSeverity(type, (metadata ?? {}) as Record<string, unknown>)
      }
      listEvents={async (page, pageSize, filters) => {
        const result = await ListNotificationEvents(page, pageSize, filters)
        if (!result.success) throw new Error(result.error.message)
        return result.data
      }}
      markAllViewed={async () => {
        const res = await MarkAllNotificationEventsViewed()
        // Throws into `NotificationHistory`'s handler so the table reports it
        // rather than silently leaving every row unread.
        if (!res.success) throw new Error(res.error.message)
      }}
    />
  )
}
