import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { NOTIFICATION_EVENT_TYPES } from '@igniter/db/provider/enums'
import {
  notificationChannelsTable,
  notificationEventsTable,
  smtpConfigurationTable,
  type NotificationChannel,
  type InsertNotificationChannel,
  type NotificationEvent,
  type NotificationEventType,
  type SmtpConfiguration,
  type InsertSmtpConfiguration,
} from '@igniter/db/provider/schema'
import { getDb } from '@/db'

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

// Deliberately excludes `config`: it holds channel secrets (webhook URL, bot
// token) and must not be shipped to the client with the list view. Use
// getChannel(id) server-side when the config is actually needed.
export type NotificationChannelListItem = Pick<
  NotificationChannel,
  'id' | 'name' | 'type' | 'enabled' | 'notificationFlags' | 'createdAt' | 'updatedAt'
>

export async function listChannels(): Promise<NotificationChannelListItem[]> {
  return getDb()
    .select({
      id: notificationChannelsTable.id,
      name: notificationChannelsTable.name,
      type: notificationChannelsTable.type,
      enabled: notificationChannelsTable.enabled,
      notificationFlags: notificationChannelsTable.notificationFlags,
      createdAt: notificationChannelsTable.createdAt,
      updatedAt: notificationChannelsTable.updatedAt,
    })
    .from(notificationChannelsTable)
    .orderBy(notificationChannelsTable.createdAt)
}

export async function getChannel(id: number): Promise<NotificationChannel | undefined> {
  const [channel] = await getDb()
    .select()
    .from(notificationChannelsTable)
    .where(eq(notificationChannelsTable.id, id))
  return channel
}

export async function insertChannel(
  data: InsertNotificationChannel,
): Promise<NotificationChannel> {
  const [channel] = await getDb()
    .insert(notificationChannelsTable)
    .values(data)
    .returning()

  if (!channel) throw new Error('Failed to insert notification channel')
  return channel
}

export async function updateChannel(
  id: number,
  data: Partial<InsertNotificationChannel>,
): Promise<NotificationChannel> {
  const [channel] = await getDb()
    .update(notificationChannelsTable)
    .set(data)
    .where(eq(notificationChannelsTable.id, id))
    .returning()

  if (!channel) throw new Error('Failed to update notification channel')
  return channel
}

export async function deleteChannel(id: number): Promise<NotificationChannel> {
  const [channel] = await getDb()
    .delete(notificationChannelsTable)
    .where(eq(notificationChannelsTable.id, id))
    .returning()

  if (!channel) throw new Error('Failed to delete notification channel')
  return channel
}

export async function getSmtpConfig(): Promise<SmtpConfiguration | null> {
  const [config] = await getDb().select().from(smtpConfigurationTable).limit(1)
  return config ?? null
}

export async function upsertSmtpConfig(
  data: Omit<InsertSmtpConfiguration, 'password'> & { password?: string },
): Promise<SmtpConfiguration> {
  const existing = await getSmtpConfig()

  if (existing) {
    // Omit the password column when none was provided so the stored one is kept
    const { password, ...rest } = data
    const [updated] = await getDb()
      .update(smtpConfigurationTable)
      .set(password ? { ...rest, password } : rest)
      .where(eq(smtpConfigurationTable.id, existing.id))
      .returning()
    if (!updated) throw new Error('Failed to update SMTP configuration')
    return updated
  }

  if (!data.password) throw new Error('Password is required')

  const [inserted] = await getDb()
    .insert(smtpConfigurationTable)
    .values({ ...data, password: data.password })
    .returning()
  if (!inserted) throw new Error('Failed to insert SMTP configuration')
  return inserted
}

export async function deleteSmtpConfig(): Promise<void> {
  await getDb().delete(smtpConfigurationTable)
}

export async function listNotificationEvents(
  page: number,
  pageSize: number,
  filters?: NotificationEventFilters,
): Promise<{ data: NotificationEvent[]; total: number; unviewedTotal: number }> {
  const db = getDb()
  const conds = buildNotificationEventFilterConditions(filters)
  const where = conds.length ? and(...conds) : undefined
  const [rows, [countRow], [unviewedRow]] = await Promise.all([
    db
      .select()
      .from(notificationEventsTable)
      .where(where)
      .orderBy(desc(notificationEventsTable.createdAt))
      .limit(pageSize)
      .offset(page * pageSize),
    db.select({ total: count() }).from(notificationEventsTable).where(where),
    // Global unread count (independent of the search filter) so the badge and
    // mark-all reflect the true unread total, not just the current page/search.
    db.select({ total: count() }).from(notificationEventsTable).where(isNull(notificationEventsTable.viewedAt)),
  ])
  return { data: rows, total: countRow?.total ?? 0, unviewedTotal: unviewedRow?.total ?? 0 }
}

export async function getNotificationEvent(uuid: string): Promise<NotificationEvent | null> {
  const [event] = await getDb()
    .select()
    .from(notificationEventsTable)
    .where(eq(notificationEventsTable.uuid, uuid))
  return event ?? null
}

export async function listUnviewedNotificationEvents(): Promise<NotificationEvent[]> {
  return getDb()
    .select()
    .from(notificationEventsTable)
    .where(isNull(notificationEventsTable.viewedAt))
    .orderBy(desc(notificationEventsTable.createdAt))
    .limit(20)
}

export async function markNotificationEventsViewed(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await getDb()
    .update(notificationEventsTable)
    .set({ viewedAt: new Date() })
    .where(inArray(notificationEventsTable.id, ids))
}

export async function markAllNotificationEventsViewed(): Promise<void> {
  await getDb()
    .update(notificationEventsTable)
    .set({ viewedAt: new Date() })
    .where(isNull(notificationEventsTable.viewedAt))
}
