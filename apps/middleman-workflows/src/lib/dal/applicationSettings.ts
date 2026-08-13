import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import { eq } from 'drizzle-orm'


export default class ApplicationSettings {
  logger: Logger

  dbClient: DBClient<typeof schema>

  /**
   * Constructs a new instance of the class.
   *
   * @param {DBClient<typeof schema>} dbClient - The database client instance used for database operations.
   * @param {Logger} logger - The logger instance used for logging activities in the application.
   */
  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async getFirst() {
    return this.dbClient.db.query.applicationSettingsTable.findFirst();
  }

  async update(data: Partial<{ pocketRpcUrl: string; pocketApiUrl: string }>) {
    const first = await this.getFirst()
    if (!first) {
      this.logger.warn('Cannot update settings — no settings row exists', { data })
      return
    }
    await this.dbClient.db
      .update(schema.applicationSettingsTable)
      .set(data)
      .where(eq(schema.applicationSettingsTable.id, first.id))
    this.logger.info('Updated application settings', { data })
  }

  async isBootstrapped(): Promise<boolean> {
    const settings = await this.dbClient.db
      .select({ isBootstrapped: schema.applicationSettingsTable.isBootstrapped })
      .from(schema.applicationSettingsTable)
      .then(r => (r.length ? r[0] : null))
    return settings?.isBootstrapped ?? false
  }
}
