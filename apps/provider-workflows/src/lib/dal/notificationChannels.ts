import type { Logger } from '@igniter/logger'
import * as schema from '@igniter/db/provider/schema'
import type { DBClient } from '@igniter/db/connection'
import type { NotificationChannel, SmtpConfiguration, InsertNotificationEvent, NotificationEvent } from '@igniter/db/provider/schema'
import { eq } from 'drizzle-orm'

export default class NotificationChannels {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async loadEnabledChannels(): Promise<NotificationChannel[]> {
    return this.dbClient.db
      .select()
      .from(schema.notificationChannelsTable)
      .where(eq(schema.notificationChannelsTable.enabled, true))
  }

  async loadSmtpConfig(): Promise<SmtpConfiguration | null> {
    const rows = await this.dbClient.db
      .select()
      .from(schema.smtpConfigurationTable)
      .limit(1)
    return rows.length ? rows[0]! : null
  }

  async insertNotificationEvent(data: InsertNotificationEvent): Promise<NotificationEvent> {
    const [row] = await this.dbClient.db
      .insert(schema.notificationEventsTable)
      .values(data)
      .returning()
    if (!row) throw new Error('Failed to insert notification event')
    return row
  }
}
