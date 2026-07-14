import 'server-only'
import { getDb } from '@/db'
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { NOTIFICATION_EVENT_TYPES } from '@igniter/db/middleman/enums'
import {
  notificationChannelsTable,
  notificationEventsTable,
  notificationPreferencesTable,
  type InsertNotificationChannel,
  type InsertNotificationEvent,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationPreferences,
} from '@igniter/db/middleman/schema'

// Server-side filters for the notification history table. All optional; an
// absent field means "no constraint on that dimension".
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

// Translates the optional filter set into a list of AND-able SQL conditions.
// Exported for unit testing of the filter branching.
export function buildNotificationEventFilterConditions(filters?: NotificationEventFilters) {
  const conds = []
  // Only push a type condition for a KNOWN enum member — an arbitrary string
  // (e.g. a hand-crafted request bypassing the UI) would otherwise reach the
  // enum column and make Postgres throw "invalid input value for enum".
  if (filters?.type && (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(filters.type)) {
    conds.push(eq(notificationEventsTable.type, filters.type as NotificationEventType))
  }
  if (filters?.read === 'unread') conds.push(isNull(notificationEventsTable.viewedAt))
  if (filters?.read === 'read') conds.push(isNotNull(notificationEventsTable.viewedAt))
  if (filters?.search) {
    conds.push(sql`${notificationEventsTable.uuid}::text ILIKE ${'%' + filters.search + '%'}`)
  }
  if (filters?.channel) {
    // channels is a JSON array of { type, ... }; match any element's type.
    conds.push(
      sql`EXISTS (SELECT 1 FROM json_array_elements(${notificationEventsTable.channels}) elem WHERE elem->>'type' = ${filters.channel})`,
    )
  }
  return conds
}

// The list/table view never receives the encrypted config — secrets stay on the
// server. Only these non-secret columns are selected.
const listColumns = {
  id: notificationChannelsTable.id,
  name: notificationChannelsTable.name,
  type: notificationChannelsTable.type,
  enabled: notificationChannelsTable.enabled,
  notificationFlags: notificationChannelsTable.notificationFlags,
  createdAt: notificationChannelsTable.createdAt,
}

export type NotificationChannelListItem = {
  id: number
  name: string
  type: NotificationChannel['type']
  enabled: boolean
  notificationFlags: NotificationChannel['notificationFlags']
  createdAt: Date | null
}

// ─── Channels (all scoped to the owning wallet via createdBy) ────────────────

export async function listChannels(userIdentity: string): Promise<NotificationChannelListItem[]> {
  return getDb()
    .select(listColumns)
    .from(notificationChannelsTable)
    .where(eq(notificationChannelsTable.createdBy, userIdentity))
    .orderBy(desc(notificationChannelsTable.createdAt))
}

// Full row incl. (decrypted) config — used server-side for edit/test/dispatch.
export async function getChannel(
  id: number,
  userIdentity: string,
): Promise<NotificationChannel | undefined> {
  const [row] = await getDb()
    .select()
    .from(notificationChannelsTable)
    .where(
      and(
        eq(notificationChannelsTable.id, id),
        eq(notificationChannelsTable.createdBy, userIdentity),
      ),
    )
    .limit(1)
  return row
}

export async function insertChannel(
  data: InsertNotificationChannel,
): Promise<NotificationChannelListItem> {
  const [row] = await getDb()
    .insert(notificationChannelsTable)
    .values(data)
    .returning(listColumns)
  return row!
}

export async function updateChannel(
  id: number,
  userIdentity: string,
  data: Partial<InsertNotificationChannel>,
): Promise<NotificationChannelListItem | undefined> {
  const [row] = await getDb()
    .update(notificationChannelsTable)
    .set(data)
    .where(
      and(
        eq(notificationChannelsTable.id, id),
        eq(notificationChannelsTable.createdBy, userIdentity),
      ),
    )
    .returning(listColumns)
  return row
}

export async function deleteChannel(id: number, userIdentity: string): Promise<void> {
  await getDb()
    .delete(notificationChannelsTable)
    .where(
      and(
        eq(notificationChannelsTable.id, id),
        eq(notificationChannelsTable.createdBy, userIdentity),
      ),
    )
}

// Enabled channels for one owner — used by the dispatch path (workflow side).
export async function loadEnabledChannelsForOwner(
  userIdentity: string,
): Promise<NotificationChannel[]> {
  return getDb()
    .select()
    .from(notificationChannelsTable)
    .where(
      and(
        eq(notificationChannelsTable.createdBy, userIdentity),
        eq(notificationChannelsTable.enabled, true),
      ),
    )
}

// ─── Events (per-user feed + delivery log) ───────────────────────────────────

export async function insertNotificationEvent(
  data: InsertNotificationEvent,
): Promise<void> {
  await getDb().insert(notificationEventsTable).values(data)
}

export async function listNotificationEvents(
  userIdentity: string,
  page = 0,
  pageSize = 25,
  filters?: NotificationEventFilters,
): Promise<{ data: NotificationEvent[]; total: number; unviewedTotal: number }> {
  const db = getDb()
  // Scoped to the owning wallet on BOTH the rows query and the counts, so the
  // paginated total never leaks other wallets' events. Filters are ANDed on top.
  const where = and(
    eq(notificationEventsTable.createdBy, userIdentity),
    ...buildNotificationEventFilterConditions(filters),
  )
  // Unread count stays scoped-but-unfiltered so the badge/mark-all reflect the
  // true unread total regardless of the active filters.
  const unviewedWhere = and(
    eq(notificationEventsTable.createdBy, userIdentity),
    isNull(notificationEventsTable.viewedAt),
  )
  const [rows, [countRow], [unviewedRow]] = await Promise.all([
    db
      .select()
      .from(notificationEventsTable)
      .where(where)
      .orderBy(desc(notificationEventsTable.createdAt))
      .limit(pageSize)
      .offset(page * pageSize),
    db.select({ total: count() }).from(notificationEventsTable).where(where),
    // Full unread count (all pages) so the badge/mark-all reflect the true total.
    db.select({ total: count() }).from(notificationEventsTable).where(unviewedWhere),
  ])
  return { data: rows, total: countRow?.total ?? 0, unviewedTotal: unviewedRow?.total ?? 0 }
}

export async function getNotificationEvent(
  uuid: string,
  userIdentity: string,
): Promise<NotificationEvent | undefined> {
  const [row] = await getDb()
    .select()
    .from(notificationEventsTable)
    .where(
      and(
        eq(notificationEventsTable.uuid, uuid),
        eq(notificationEventsTable.createdBy, userIdentity),
      ),
    )
    .limit(1)
  return row
}

export async function listUnviewedNotificationEvents(
  userIdentity: string,
): Promise<NotificationEvent[]> {
  return getDb()
    .select()
    .from(notificationEventsTable)
    .where(
      and(
        eq(notificationEventsTable.createdBy, userIdentity),
        isNull(notificationEventsTable.viewedAt),
      ),
    )
    .orderBy(desc(notificationEventsTable.createdAt))
    .limit(20)
}

export async function markNotificationEventsViewed(
  ids: number[],
  userIdentity: string,
): Promise<void> {
  if (ids.length === 0) return
  await getDb()
    .update(notificationEventsTable)
    .set({ viewedAt: new Date() })
    .where(
      and(
        inArray(notificationEventsTable.id, ids),
        eq(notificationEventsTable.createdBy, userIdentity),
      ),
    )
}

export async function markAllNotificationEventsViewed(userIdentity: string): Promise<void> {
  await getDb()
    .update(notificationEventsTable)
    .set({ viewedAt: new Date() })
    .where(
      and(
        eq(notificationEventsTable.createdBy, userIdentity),
        isNull(notificationEventsTable.viewedAt),
      ),
    )
}

// ─── Per-wallet preferences ──────────────────────────────────────────────────

export async function getPreferences(
  userIdentity: string,
): Promise<NotificationPreferences | undefined> {
  const [row] = await getDb()
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userIdentity, userIdentity))
    .limit(1)
  return row
}

export async function setInAppFeedEnabled(userIdentity: string, enabled: boolean): Promise<void> {
  await getDb()
    .insert(notificationPreferencesTable)
    .values({ userIdentity, inAppFeedEnabled: enabled })
    .onConflictDoUpdate({
      target: notificationPreferencesTable.userIdentity,
      set: { inAppFeedEnabled: enabled, updatedAt: new Date() },
    })
}
