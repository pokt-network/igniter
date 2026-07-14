'use client'

import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NotificationHistory } from '@igniter/ui/components/NotificationChannels/NotificationHistory'
import type { NotificationHistoryEvent } from '@igniter/ui/components/NotificationChannels/NotificationHistory'
import {
  ListNotificationEvents,
  MarkNotificationEventsViewed,
  MarkAllNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import { EVENT_LABELS, describeEvent } from '@/lib/notificationEvents'
import { NOTIFICATION_EVENT_TYPES, NotificationChannelType } from '@igniter/db/middleman/enums'

// Event-type + channel dropdown options for the history filters.
const EVENT_TYPE_OPTIONS = NOTIFICATION_EVENT_TYPES.map((t) => ({
  value: t,
  label: EVENT_LABELS[t] ?? t,
}))
const CHANNEL_OPTIONS = Object.values(NotificationChannelType).map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}))

// Middleman wrapper around the shared history table: wallet-scoped actions +
// middleman's event vocabulary. No detail drawer (provider-only), so a row click
// just marks the event read.
export function NotificationHistorySection() {
  const queryClient = useQueryClient()

  const openEvent = (event: NotificationHistoryEvent) => {
    if (event.viewedAt) return
    MarkNotificationEventsViewed([event.id]).then(() => {
      queryClient.invalidateQueries({ queryKey: ['notification-events'] })
      queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    })
  }

  return (
    <NotificationHistory
      eventTypeOptions={EVENT_TYPE_OPTIONS}
      channelOptions={CHANNEL_OPTIONS}
      onOpenEvent={openEvent}
      labelFor={(type) => EVENT_LABELS[type] ?? 'Notification'}
      summaryFor={(type, metadata) =>
        describeEvent(type, (metadata ?? {}) as Record<string, unknown>)
      }
      listEvents={async (page, pageSize, filters) => {
        const result = await ListNotificationEvents(page, pageSize, filters)
        if (!result.success) throw new Error(result.error.message)
        return result.data
      }}
      markAllViewed={async () => {
        await MarkAllNotificationEventsViewed()
      }}
    />
  )
}
