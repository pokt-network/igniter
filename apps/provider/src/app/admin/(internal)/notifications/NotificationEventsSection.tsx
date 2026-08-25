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
import { notify } from '@igniter/ui/lib/sessionMessages'
import type { ProviderQuickDetailItem } from '@/app/admin/details/types'
import type { NotificationEvent, NotificationEventMetadata } from '@igniter/db/provider/schema'
import { NOTIFICATION_EVENT_TYPES } from '@igniter/db/provider/enums'
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_SEVERITY,
  REMEDIATION_REASON_LABELS,
} from '@/lib/constants'

// Event-type dropdown options for the history filter.
const EVENT_TYPE_OPTIONS = NOTIFICATION_EVENT_TYPES.map((t) => ({
  value: t,
  label: NOTIFICATION_EVENT_LABELS[t as keyof typeof NOTIFICATION_EVENT_LABELS] ?? t,
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
  // Guards against re-opening the drawer on a re-render while `?uuid=` is still
  // on the URL. Re-armed as soon as the param clears (below), so a second
  // deep-link raised on this same mounted page opens again — the bell's "View
  // details" is clicked from here as often as from anywhere else, and a
  // mount-lifetime latch would swallow every click after the first.
  const deepLinkOpened = useRef(false)

  const invalidateViewed = () => {
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-count'] })
    queryClient.invalidateQueries({ queryKey: ['notification-events'] })
    // The deep-link row too: it caches `viewedAt`, and a second visit to the same
    // ?uuid= within its cache lifetime would otherwise replay off the stale copy —
    // opening a duplicate drawer entry and re-stamping an event already marked.
    queryClient.invalidateQueries({ queryKey: ['notification-event-deeplink'] })
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
    if (!uuidParam) {
      deepLinkOpened.current = false
      return
    }
    if (!deepLinkEvent || deepLinkOpened.current) return
    deepLinkOpened.current = true
    addItem({ type: 'notification', body: deepLinkEvent })
    if (!deepLinkEvent.viewedAt) {
      MarkNotificationEventsViewed([deepLinkEvent.id]).then(invalidateViewed)
    }
    // Strip the param so the URL is not a stale deep-link, and so the guard
    // above re-arms for the next one.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('uuid')
    const query = params.toString()
    router.replace(query ? `?${query}` : '?', { scroll: false })
  }, [uuidParam, deepLinkEvent])

  const openEvent = (event: NotificationHistoryEvent) => {
    // At runtime the row IS the full provider NotificationEvent (listEvents
    // returns them); the shared table only exposes the common subset.
    addItem({ type: 'notification', body: event as unknown as NotificationEvent })
    if (!event.viewedAt) {
      void MarkNotificationEventsViewed([event.id])
        .then((result) => {
          if (!result.success) throw new Error(result.error.message)
          invalidateViewed()
        })
        .catch((err) => {
          // Same rule as the bell's ✕: a mark-read that did not persist has to
          // say so, or the row comes back unread and the click looks broken.
          notify.error('Could not mark this notification as read.', {
            id: `mark-read-error-${event.id}`,
            description: err instanceof Error ? err.message : undefined,
          })
          invalidateViewed()
        })
    }
  }

  return (
    <NotificationHistory
      enableSearch
      eventTypeOptions={EVENT_TYPE_OPTIONS}
      onMarkAllViewed={onMarkAllViewed}
      onOpenEvent={openEvent}
      renderChannelIcon={(type) => <NotificationChannelIcon type={type} className="h-3 w-3 shrink-0" />}
      labelFor={(type) =>
        NOTIFICATION_EVENT_LABELS[type as keyof typeof NOTIFICATION_EVENT_LABELS] ?? type
      }
      summaryFor={(type, metadata) => metadataSummary(type, metadata as NotificationEventMetadata)}
      severityFor={(type) =>
        NOTIFICATION_EVENT_SEVERITY[type as keyof typeof NOTIFICATION_EVENT_SEVERITY] ?? 'info'
      }
      listEvents={async (page, pageSize, filters) => {
        const result = await ListNotificationEvents(page, pageSize, filters)
        if (!result.success) throw new Error(result.error.message)
        return result.data
      }}
      markAllViewed={async () => {
        const result = await MarkAllNotificationEventsViewed()
        // Throws into `NotificationHistory`'s handler so the table reports it
        // rather than silently leaving every row unread.
        if (!result.success) throw new Error(result.error.message)
      }}
    />
  )
}
