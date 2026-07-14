'use client'

import React, { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import { NotificationHistory } from '@igniter/ui/components/NotificationChannels/NotificationHistory'
import type { NotificationHistoryEvent } from '@igniter/ui/components/NotificationChannels/NotificationHistory'
import { NotificationChannelIcon } from '@/components/NotificationChannelIcon'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'
import {
  ListNotificationEvents,
  GetNotificationEvent,
  MarkNotificationEventsViewed,
  MarkAllNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import type { ProviderQuickDetailItem } from '@/app/admin/details/types'
import type { NotificationEvent, NotificationEventMetadata } from '@igniter/db/provider/schema'
import { NOTIFICATION_EVENT_TYPES, NotificationChannelType } from '@igniter/db/provider/enums'
import { NOTIFICATION_EVENT_LABELS, REMEDIATION_REASON_LABELS } from '@/lib/constants'

// Event-type + channel dropdown options for the history filters.
const EVENT_TYPE_OPTIONS = NOTIFICATION_EVENT_TYPES.map((t) => ({
  value: t,
  label: NOTIFICATION_EVENT_LABELS[t as keyof typeof NOTIFICATION_EVENT_LABELS] ?? t,
}))
const CHANNEL_OPTIONS = Object.values(NotificationChannelType).map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}))

function metadataSummary(type: string, metadata: NotificationEventMetadata | null | undefined): string {
  if (!metadata) return '—'
  if ('addresses' in metadata) {
    const n = metadata.addresses.length
    return `${n} address${n !== 1 ? 'es' : ''}`
  }
  if ('byReason' in metadata) {
    return Object.entries(metadata.byReason)
      .map(([r, { succeeded, failed }]) => {
        const label = REMEDIATION_REASON_LABELS[r] ?? r
        const parts = []
        if (succeeded.length > 0) parts.push(`${succeeded.length}✓`)
        if (failed.length > 0) parts.push(`${failed.length}✗`)
        return `${label}: ${parts.join(' ')}`
      })
      .join('\n')
  }
  if ('inserted' in metadata) {
    const total = metadata.inserted + metadata.updated + metadata.disabled
    return `${total} change${total !== 1 ? 's' : ''}`
  }
  return '—'
}

export interface NotificationEventsSectionProps {
  onMarkAllViewed?: () => void
}

// Provider wrapper around the shared history table. Adds the provider-only bits:
// the QuickDetails detail drawer, the ?uuid= deep-link (from notification emails),
// and UUID search. The table/pagination/mark-all UI lives in @igniter/ui.
export function NotificationEventsSection({ onMarkAllViewed }: NotificationEventsSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const addItem = useAddItemToDetail<ProviderQuickDetailItem>()
  const uuidParam = searchParams.get('uuid')
  const deepLinkOpened = useRef(false)

  const invalidateViewed = () => {
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['notification-events'] })
  }

  // Deep-link: open the drawer when navigating with ?uuid= (e.g. from an email).
  const { data: deepLinkEvent } = useQuery({
    queryKey: ['notification-event-deeplink', uuidParam],
    queryFn: async () => {
      const result = await GetNotificationEvent(uuidParam!)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    enabled: !!uuidParam,
  })

  useEffect(() => {
    if (deepLinkEvent && !deepLinkOpened.current) {
      deepLinkOpened.current = true
      addItem({ type: 'notification', body: deepLinkEvent })
      if (!deepLinkEvent.viewedAt) {
        MarkNotificationEventsViewed([deepLinkEvent.id]).then(invalidateViewed)
      }
      const params = new URLSearchParams(searchParams.toString())
      params.delete('uuid')
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [deepLinkEvent])

  const openEvent = (event: NotificationHistoryEvent) => {
    // At runtime the row IS the full provider NotificationEvent (listEvents
    // returns them); the shared table only exposes the common subset.
    addItem({ type: 'notification', body: event as unknown as NotificationEvent })
    if (!event.viewedAt) {
      MarkNotificationEventsViewed([event.id]).then(invalidateViewed)
    }
  }

  return (
    <NotificationHistory
      eventTypeOptions={EVENT_TYPE_OPTIONS}
      channelOptions={CHANNEL_OPTIONS}
      onMarkAllViewed={onMarkAllViewed}
      onOpenEvent={openEvent}
      renderChannelIcon={(type) => <NotificationChannelIcon type={type} className="h-3 w-3 shrink-0" />}
      labelFor={(type) =>
        NOTIFICATION_EVENT_LABELS[type as keyof typeof NOTIFICATION_EVENT_LABELS] ?? type
      }
      summaryFor={(type, metadata) => metadataSummary(type, metadata as NotificationEventMetadata)}
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
