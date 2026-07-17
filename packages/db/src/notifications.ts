import { eq, isNotNull, isNull, sql, type Column, type SQL } from 'drizzle-orm'

// Server-side filters for the notification history table. All optional; an
// absent field means "no constraint on that dimension". App-agnostic — provider
// and middleman share the identical shape.
export type NotificationEventFilters = {
  /** Partial, case-insensitive match on the event UUID. */
  search?: string
  /** Exact event type (e.g. 'stake', 'service_change'). */
  type?: string
  /** Read/unread by viewedAt presence. */
  read?: 'read' | 'unread'
  /** Delivering channel type (e.g. 'discord') — matched against the channels JSON. */
  channel?: string
}

// The subset of a notificationEventsTable's columns that filtering touches.
// Provider and middleman each own their own table, but both expose these
// identically, so the builder is app-agnostic — each app binds its own table.
export type NotificationEventFilterColumns = {
  type: Column
  viewedAt: Column
  uuid: Column
  channels: Column
}

// Translates the optional filter set into a list of AND-able SQL conditions.
// `eventTypes` is the app's NOTIFICATION_EVENT_TYPES: only a KNOWN enum member
// yields a type condition — an arbitrary string (e.g. a hand-crafted request
// bypassing the UI) would otherwise reach the enum column and make Postgres
// throw "invalid input value for enum".
export function buildNotificationEventFilterConditions(
  columns: NotificationEventFilterColumns,
  eventTypes: readonly string[],
  filters?: NotificationEventFilters,
): SQL[] {
  const conds: SQL[] = []
  if (filters?.type && eventTypes.includes(filters.type)) {
    conds.push(eq(columns.type, filters.type))
  }
  if (filters?.read === 'unread') conds.push(isNull(columns.viewedAt))
  if (filters?.read === 'read') conds.push(isNotNull(columns.viewedAt))
  if (filters?.search) {
    conds.push(sql`${columns.uuid}::text ILIKE ${'%' + filters.search + '%'}`)
  }
  if (filters?.channel) {
    // channels is a JSON array of { type, ... }; match any element's type.
    conds.push(
      sql`EXISTS (SELECT 1 FROM json_array_elements(${columns.channels}) elem WHERE elem->>'type' = ${filters.channel})`,
    )
  }
  return conds
}