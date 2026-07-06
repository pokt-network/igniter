'use client'

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DataTable from '../DataTable/index'
import { Button } from '../button'
import { Input } from '../input'
import { RightArrowIcon } from '../../assets'
import type { ColumnDef } from '../table'
import type { CsvColumnDef } from '../../lib/csv'

// A single per-channel delivery result as stored on an event. Kept structural so
// both apps' NotificationEventChannel shapes are assignable.
export interface NotificationHistoryChannel {
  id: number
  name: string
  type: string
  status?: string
  error?: string
}

// The minimal event shape the history table renders. Both provider and middleman
// `NotificationEvent` rows are structurally assignable to this (metadata is kept
// `unknown` so each app's typed metadata union fits; provider's extra/missing
// columns don't matter here).
export interface NotificationHistoryEvent {
  id: number
  uuid: string
  type: string
  metadata: unknown
  channels: NotificationHistoryChannel[]
  createdAt: Date | string
  viewedAt: Date | string | null
}

export interface NotificationHistoryProps {
  /** App-specific, wallet/owner-scoped fetch returning a page + total count. */
  listEvents: (
    page: number,
    pageSize: number,
    search?: string,
  ) => Promise<{ data: NotificationHistoryEvent[]; total: number }>
  /** Marks every unread event viewed (app-scoped). */
  markAllViewed: () => Promise<void>
  /** Human label for an event type (vocabularies differ per app). */
  labelFor: (type: string) => string
  /** One-line summary from an event's metadata. */
  summaryFor: (type: string, metadata: unknown) => string
  /** Optional per-channel-type icon for the channel chips. */
  renderChannelIcon?: (type: string) => React.ReactNode
  /** Row click handler (e.g. open a detail drawer / mark viewed). Row action only rendered when set. */
  onOpenEvent?: (event: NotificationHistoryEvent) => void
  /** Called after a successful mark-all so the caller can refresh app-specific queries (e.g. a header badge). */
  onMarkAllViewed?: () => void
  /** Show the UUID search box (only apps whose listEvents accepts a search term). */
  enableSearch?: boolean
  /** react-query cache namespace; also the key invalidated on mark-all. */
  queryKey?: string
  pageSize?: number
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Presentational, app-agnostic notification history: a server-paginated table of
 * past events (newest first) with an unread indicator, per-channel delivery
 * chips, UUID search (optional) and a mark-all-read control. All data access and
 * per-event vocabulary are injected as props so both provider and middleman
 * wrap it with their own actions/labels.
 */
export function NotificationHistory({
  listEvents,
  markAllViewed,
  labelFor,
  summaryFor,
  renderChannelIcon,
  onOpenEvent,
  onMarkAllViewed,
  enableSearch = false,
  queryKey = 'notification-events',
  pageSize: initialPageSize = 25,
}: NotificationHistoryProps) {
  const queryClient = useQueryClient()
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [search, setSearch] = useState('')
  const [isMarkingAll, setIsMarkingAll] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [queryKey, pageIndex, pageSize, search],
    queryFn: () => listEvents(pageIndex, pageSize, search || undefined),
  })

  const handleMarkAll = async () => {
    setIsMarkingAll(true)
    try {
      await markAllViewed()
      queryClient.invalidateQueries({ queryKey: [queryKey] })
      // The header/topbar feed (both apps) is keyed on unviewed events.
      queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
      onMarkAllViewed?.()
    } finally {
      setIsMarkingAll(false)
    }
  }

  const columns: Array<ColumnDef<NotificationHistoryEvent> & CsvColumnDef<NotificationHistoryEvent>> = [
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
      cell: ({ row }) => labelFor(row.getValue('type') as string),
    },
    {
      id: 'summary',
      header: 'Summary',
      cell: ({ row }) => (
        <span className="text-text-secondary whitespace-pre-wrap">
          {summaryFor(row.original.type, row.original.metadata)}
        </span>
      ),
    },
    {
      accessorKey: 'channels',
      header: 'Channels',
      cell: ({ row }) => {
        const channels = (row.getValue('channels') ?? []) as NotificationHistoryChannel[]
        if (channels.length === 0)
          return <span className="text-text-tertiary text-xs">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {channels.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 text-xs bg-bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-text-secondary"
              >
                {renderChannelIcon?.(c.type)}
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
      {(enableSearch || unviewedCount > 0) && (
        <div className="flex items-center gap-3">
          {enableSearch && (
            <Input
              placeholder="Search by UUID…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPageIndex(0)
              }}
              className="max-w-xs"
            />
          )}
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
      )}

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
        itemActions={
          onOpenEvent
            ? (event) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="border-0"
                  onClick={() => onOpenEvent(event)}
                >
                  <RightArrowIcon style={{ width: '18px', height: '18px' }} />
                </Button>
              )
            : undefined
        }
      />
    </div>
  )
}
