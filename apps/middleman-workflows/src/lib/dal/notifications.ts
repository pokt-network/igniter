import {
  notificationChannelsTable,
  notificationEventsTable,
} from '@igniter/db/middleman/schema'
import type {
  NotificationChannel,
  InsertNotificationEvent,
} from '@igniter/db/middleman/schema'
import { and, eq } from 'drizzle-orm'
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'

export default class Notifications {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  // Enabled channels owned by one wallet — the per-user delivery set. The
  // caller filters further by the channel's per-event notificationFlags.
  async loadEnabledChannelsForOwner(ownerIdentity: string): Promise<NotificationChannel[]> {
    return this.dbClient.db
      .select()
      .from(notificationChannelsTable)
      .where(
        and(
          eq(notificationChannelsTable.createdBy, ownerIdentity),
          eq(notificationChannelsTable.enabled, true),
        ),
      )
  }

  async insertEvent(data: InsertNotificationEvent): Promise<void> {
    await this.dbClient.db.insert(notificationEventsTable).values(data)
  }
}
