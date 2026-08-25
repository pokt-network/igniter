'use client'

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DataTable from '../DataTable/index'
import { Button } from '../button'
import { Input } from '../input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../select'
import { RightArrowIcon } from '../../assets'
import { FailureReasonPopover } from '../FailureReasonPopover'
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

/** Severity of an event, used to tint its row. Mirrors the notification bell. */
export type NotificationHistorySeverity = 'error' | 'warning' | 'info' | 'success'

// Severity → column label + token classes. The wording covers both apps'
// vocabularies: "Attention" rather than "Warning" because that bucket is drift
// nobody asked for (rev-share changed, funds low) rather than a malfunction, and
// "Issue" rather than "Failed" because the error bucket is a failed transaction
// in middleman but a supplier below the minimum stake in provider.
const SEVERITY_BADGE: Record<
  NotificationHistorySeverity,
  { label: string; className: string }
> = {
  success: { label: 'Success', className: 'bg-success-bg text-success border-success/40' },
  warning: { label: 'Attention', className: 'bg-warning-bg text-warning border-warning/40' },
  error: { label: 'Issue', className: 'bg-error-bg text-error border-error/40' },
  info: { label: 'Info', className: 'bg-info-bg text-accent border-accent/40' },
}

/** A selectable value for one of the filter dropdowns. */
export interface NotificationFilterOption {
  value: string
  label: string
}

/** Server-side filter selection sent to `listEvents`. Absent field = unconstrained. */
export interface NotificationHistoryFilters {
  search?: string
  type?: string
  read?: 'read' | 'unread'
}

export interface NotificationHistoryProps {
  /**
   * App-specific, wallet/owner-scoped fetch returning a page + total count.
   * `unviewedTotal` is the server-side count of ALL unread events (not just this
   * page) so the badge and the mark-all control reflect the true unread total
   * rather than however many unread rows happen to land on the current page.
   * `filters` carries the active dropdown/search selection (all optional).
   */
  listEvents: (
    page: number,
    pageSize: number,
    filters?: NotificationHistoryFilters,
  ) => Promise<{ data: NotificationHistoryEvent[]; total: number; unviewedTotal?: number }>
  /** When set, renders an event-type filter dropdown (each app's own vocabulary). */
  eventTypeOptions?: NotificationFilterOption[]
  /** Marks every unread event viewed (app-scoped). */
  markAllViewed: () => Promise<void>
  /** Human label for an event type (vocabularies differ per app). */
  labelFor: (type: string) => string
  /** One-line summary from an event's metadata. */
  summaryFor: (type: string, metadata: unknown) => string
  /**
   * Severity for an event, used to tint the row. Each app derives it its own way
   * — provider from a per-type map, middleman from `metadata.outcome` — so it is
   * injected rather than computed here. Rows stay neutral when omitted.
   */
  severityFor?: (type: string, metadata: unknown) => NotificationHistorySeverity
  /** Optional per-channel-type icon for the channel chips. */
  renderChannelIcon?: (type: string) => React.ReactNode
  /** Row click handler (e.g. open a detail drawer / mark viewed). Row action only rendered when set. */
  onOpenEvent?: (event: NotificationHistoryEvent) => void
  /**
   * What the row action promises. The default arrow reads as "takes me
   * somewhere", which is only true for a wrapper that has somewhere to go:
   * middleman has no detail view, so its rows mark read instead and say so.
   */
  itemActionIcon?: React.ReactNode
  /** Tooltip / accessible name for the row action. */
  itemActionLabel?: string
  /** Hide the row action for some events (e.g. one already marked read). */
  showItemAction?: (event: NotificationHistoryEvent) => boolean
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
  eventTypeOptions,
  markAllViewed,
  labelFor,
  summaryFor,
  severityFor,
  renderChannelIcon,
  onOpenEvent,
  itemActionIcon,
  itemActionLabel = 'View details',
  showItemAction,
  onMarkAllViewed,
  enableSearch = false,
  queryKey = 'notification-events',
  pageSize: initialPageSize = 25,
}: NotificationHistoryProps) {
  const queryClient = useQueryClient()
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [readFilter, setReadFilter] = useState<'' | 'read' | 'unread'>('')
  const [isMarkingAll, setIsMarkingAll] = useState(false)

  // Any filter change resets to page 0 so the user isn't stranded on a page
  // that no longer exists under the narrower result set.
  const onFilterChange = (apply: () => void) => {
    apply()
    setPageIndex(0)
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [queryKey, pageIndex, pageSize, search, typeFilter, readFilter],
    queryFn: () =>
      listEvents(pageIndex, pageSize, {
        search: search || undefined,
        type: typeFilter || undefined,
        read: readFilter || undefined,
      }),
  })

  const handleMarkAll = async () => {
    setIsMarkingAll(true)
    try {
      await markAllViewed()
      queryClient.invalidateQueries({ queryKey: [queryKey] })
      // The topbar bell (both apps) reads the unviewed list and its own unread
      // count query; both must refresh or the badge keeps the stale total.
      queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
      queryClient.invalidateQueries({ queryKey: ['unviewed-notification-count'] })
      onMarkAllViewed?.()
    } finally {
      setIsMarkingAll(false)
    }
  }

  // Rendered only when the app supplies `severityFor`, so a wrapper that doesn't
  // classify events keeps its old table. Declared out of the literal below and
  // spread in: filtering the literal afterwards erases its contextual type and
  // every `cell: ({ row })` silently widens to `any`.
  const severityColumn: ColumnDef<NotificationHistoryEvent> & CsvColumnDef<NotificationHistoryEvent> = {
    id: 'severity',
    // Not "Type": the column beside it is the event's type. This one is how bad
    // it is.
    header: 'Severity',
    cell: ({ row }) => {
      if (!severityFor) return null
      const badge = SEVERITY_BADGE[severityFor(row.original.type, row.original.metadata)]
      if (!badge) return null
      return (
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${badge.className}`}
        >
          {badge.label}
        </span>
      )
    },
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
    ...(severityFor ? [severityColumn] : []),
    {
      accessorKey: 'type',
      header: 'Event',
      cell: ({ row }) => labelFor(row.getValue('type') as string),
    },
    {
      id: 'summary',
      header: 'Summary',
      // Summaries run long (a remediation roll-up names every reason it fixed), so
      // the cell truncates to one line and the full text lives behind the same
      // expand-and-copy popover the transaction failure-reason column uses.
      cell: ({ row }) => {
        const summary = summaryFor(row.original.type, row.original.metadata)
        if (!summary) return <span className="text-text-tertiary text-xs">—</span>
        // Every summary gets the affordance, short ones included: a column where
        // only some cells expand reads as inconsistent, and the popover is also
        // how the text is copied.
        return (
          <FailureReasonPopover
            friendly={summary}
            full={summary}
            tone="neutral"
            label="Full summary"
            className="max-w-[28rem]"
          />
        )
      },
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

  // Prefer the server-side unread total so the badge/mark-all reflect ALL unread
  // events, not just the current page; fall back to the page-local count for an
  // app that hasn't wired unviewedTotal yet.
  const unviewedCount = data?.unviewedTotal ?? (data?.data ?? []).filter((e) => !e.viewedAt).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {enableSearch && (
          <Input
            placeholder="Search by UUID…"
            value={search}
            onChange={(e) => onFilterChange(() => setSearch(e.target.value))}
            className="max-w-xs"
          />
        )}
        {eventTypeOptions && eventTypeOptions.length > 0 && (
          <Select
            value={typeFilter || 'all'}
            onValueChange={(v) => onFilterChange(() => setTypeFilter(v === 'all' ? '' : v))}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventTypeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={readFilter || 'all'}
          onValueChange={(v) =>
            onFilterChange(() => setReadFilter(v === 'all' ? '' : (v as 'read' | 'unread')))
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>
        {unviewedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs shrink-0 ml-auto"
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
        itemActions={
          onOpenEvent
            ? (event) =>
                showItemAction && !showItemAction(event) ? (
                  // Placeholder, not nothing: the button is what sets an
                  // actionable row's height, so omitting it outright makes rows
                  // without one visibly shorter and the list jitters wherever
                  // the two kinds alternate.
                  <span aria-hidden className="inline-block h-8" />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="border-0"
                    title={itemActionLabel}
                    aria-label={itemActionLabel}
                    onClick={() => onOpenEvent(event)}
                  >
                    {itemActionIcon ?? <RightArrowIcon style={{ width: '18px', height: '18px' }} />}
                  </Button>
                )
            : undefined
        }
      />
    </div>
  )
}
