'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import { Input } from '@igniter/ui/components/input'
import { RightArrowIcon } from '@igniter/ui/assets'
import { NotificationChannelIcon } from '@/components/NotificationChannelIcon'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'
import {
  ListNotificationEvents,
  GetNotificationEvent,
  MarkNotificationEventsViewed,
  MarkAllNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import type { ProviderQuickDetailItem } from '@/app/admin/details/types'
import type {
  NotificationEvent,
  NotificationEventMetadata,
  NotificationEventChannel,
} from '@igniter/db/provider/schema'
import type { ColumnDef } from '@igniter/ui/components/table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import { NOTIFICATION_EVENT_LABELS, REMEDIATION_REASON_LABELS } from '@/lib/constants'


function formatDate(date: Date | string) {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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

const PAGE_SIZE = 25

export interface NotificationEventsSectionProps {
  onMarkAllViewed?: () => void
}

export function NotificationEventsSection({ onMarkAllViewed }: NotificationEventsSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const addItem = useAddItemToDetail<ProviderQuickDetailItem>()
  const uuidParam = searchParams.get('uuid')
  const deepLinkOpened = useRef(false)

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [isMarkingAll, setIsMarkingAll] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notification-events', pageIndex, pageSize, search],
    queryFn: async () => {
      const result = await ListNotificationEvents(pageIndex, pageSize, search || undefined)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
  })

  // Deep-link: open drawer when navigating with ?uuid= (e.g. from notification email)
  const { data: deepLinkEvent } = useQuery({
    queryKey: ['notification-event-deeplink', uuidParam],
    queryFn: async () => {
      const result = await GetNotificationEvent(uuidParam!)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    enabled: !!uuidParam,
  })

  const invalidateViewed = () => {
    queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
    queryClient.invalidateQueries({ queryKey: ['notification-events'] })
  }

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

  const openEvent = (event: NotificationEvent) => {
    addItem({ type: 'notification', body: event })
    if (!event.viewedAt) {
      MarkNotificationEventsViewed([event.id]).then(invalidateViewed)
    }
  }

  const handleMarkAll = async () => {
    setIsMarkingAll(true)
    try {
      await MarkAllNotificationEventsViewed()
      invalidateViewed()
      onMarkAllViewed?.()
    } finally {
      setIsMarkingAll(false)
    }
  }

  const columns: Array<ColumnDef<NotificationEvent> & CsvColumnDef<NotificationEvent>> = [
    {
      id: 'unread',
      header: '',
      cell: ({ row }) =>
        !row.original.viewedAt ? (
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 shrink-0" title="Unread" />
        ) : null,
    },
    {
      accessorKey: 'type',
      header: 'Event',
      cell: ({ row }) =>
        NOTIFICATION_EVENT_LABELS[row.getValue('type') as keyof typeof NOTIFICATION_EVENT_LABELS] ?? row.getValue('type'),
    },
    {
      id: 'summary',
      header: 'Summary',
      cell: ({ row }) => (
        <span className="text-text-secondary whitespace-pre-wrap">
          {metadataSummary(
            row.original.type,
            row.original.metadata as NotificationEventMetadata,
          )}
        </span>
      ),
    },
    {
      accessorKey: 'channels',
      header: 'Channels',
      cell: ({ row }) => {
        const channels = (row.getValue('channels') ?? []) as NotificationEventChannel[]
        if (channels.length === 0)
          return <span className="text-text-tertiary text-xs">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {channels.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 text-xs bg-bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-text-secondary"
              >
                <NotificationChannelIcon type={c.type} className="h-3 w-3 shrink-0" />
                {c.name}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Sent At',
      cell: ({ row }) => (
        <span className="text-text-secondary whitespace-nowrap">
          {formatDate(row.getValue('createdAt'))}
        </span>
      ),
    },
  ]

  const unviewedCount = (data?.data ?? []).filter((e) => !e.viewedAt).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by UUID…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPageIndex(0)
          }}
          className="max-w-xs"
        />
        {unviewedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs shrink-0"
            disabled={isMarkingAll}
            onClick={handleMarkAll}
          >
            Mark all as read
            <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[10px] font-bold">
              {unviewedCount}
            </span>
          </Button>
        )}
      </div>

      <DataTable
        isLoading={isLoading}
        isError={isError}
        refetch={refetch}
        columns={columns}
        data={data?.data ?? []}
        manualPagination={{
          total: data?.total ?? 0,
          pageIndex,
          pageSize,
          onPageChange: setPageIndex,
          onPageSizeChange: (size) => {
            setPageSize(size)
            setPageIndex(0)
          },
        }}
        itemActions={(event) => (
          <Button
            size="sm"
            variant="ghost"
            className="border-0"
            onClick={() => openEvent(event)}
          >
            <RightArrowIcon style={{ width: '18px', height: '18px' }} />
          </Button>
        )}
      />
    </div>
  )
}
