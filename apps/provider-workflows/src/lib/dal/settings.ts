import type {Logger} from '@igniter/logger'
import * as schema from "@igniter/db/provider/schema";
import type {DBClient} from '@igniter/db/connection'
import {ApplicationSettings} from "@igniter/db/provider/schema";
import { eq } from 'drizzle-orm'

export default class Settings {
  logger: Logger

  dbClient: DBClient<typeof schema>

  private defaults: Partial<ApplicationSettings> = {
    minimumOperationalFunds: 2,
    initialOperationalFunds: 5
  }

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async update(data: Partial<{ pocketRpcUrl: string; pocketApiUrl: string }>) {
    const settings = await this.loadSettings()
    if (!settings) {
      this.logger.warn('Cannot update settings — no settings row exists', { data })
      return
    }
    await this.dbClient.db
      .update(schema.applicationSettingsTable)
      .set(data)
      .where(eq(schema.applicationSettingsTable.id, settings.id))
    this.logger.info('Updated application settings', { data })
  }

  async isBootstrapped(): Promise<boolean> {
    const settings = await this.dbClient.db
      .select({ isBootstrapped: schema.applicationSettingsTable.isBootstrapped })
      .from(schema.applicationSettingsTable)
      .then(r => (r.length ? r[0] : null))
    return settings?.isBootstrapped ?? false
  }

  async loadSettings(): Promise<ApplicationSettings | null> {
    this.logger.debug('loadSettings: Execution Started')
    const settings = await this.dbClient.db
      .select()
      .from(schema.applicationSettingsTable)
      .then(r => (r.length ? r[0] : null))

    if (!settings) {
      this.logger.warn('loadSettings: No settings were found for the application. This is not expected.')
      return null
    }

    this.logger.debug('loadSettings: Execution Finished', {
      settingsRetrieved: {
        ...settings,
      },
      defaults: this.defaults,
    })

    return {
      ...settings,
      ...this.defaults,
    };
  }
}