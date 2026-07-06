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
      onOpenEvent={openEvent}
      labelFor={(type) => EVENT_LABELS[type] ?? 'Notification'}
      summaryFor={(type, metadata) =>
        describeEvent(type, (metadata ?? {}) as Record<string, unknown>)
      }
      listEvents={async (page, pageSize) => {
        const result = await ListNotificationEvents(page, pageSize)
        if (!result.success) throw new Error(result.error.message)
        return result.data
      }}
      markAllViewed={async () => {
        await MarkAllNotificationEventsViewed()
      }}
    />
  )
}
