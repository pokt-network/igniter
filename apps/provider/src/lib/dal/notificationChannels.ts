import { count, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  notificationChannelsTable,
  notificationEventsTable,
  smtpConfigurationTable,
  type NotificationChannel,
  type InsertNotificationChannel,
  type NotificationEvent,
  type SmtpConfiguration,
  type InsertSmtpConfiguration,
} from '@igniter/db/provider/schema'
import { getDb } from '@/db'

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
  search?: string,
): Promise<{ data: NotificationEvent[]; total: number; unviewedTotal: number }> {
  const db = getDb()
  const where = search ? eq(notificationEventsTable.uuid, search) : undefined
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
