import { eq} from "drizzle-orm";
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import {
  Provider as ProviderModel,
  providersTable,
} from '@igniter/db/middleman/schema'


export default class Provider {
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

  async list() {
    return this.dbClient.db.query.providersTable.findMany({
      // @ts-ignore (todo: fix this)
      where: (provider, { eq }) => {
        // @ts-ignore (todo: fix this)
        return eq(provider.enabled, true) && eq(provider.visible, true);
      },
    });
  }

  async updateProvider(
    providerId: number,
    provider: Partial<ProviderModel>
  ) {
    return this.dbClient.db
      .update(providersTable)
      .set(provider)
      .where(eq(providersTable.id, providerId));
  }

  async updateProviders(providers: ProviderModel[]) {
    const updates = providers.map(({ id, ...rest }) => {
      return this.updateProvider(id, rest);
    });
    await Promise.all(updates);
  }

  async getProvider(providerId: string) {
    return this.dbClient.db.query.providersTable.findFirst({
      where: eq(providersTable.identity, providerId),
    });
  }

  /**
   * Gets a provider by its identity.
   *
   * @param identity - The provider's identity
   * @returns The provider or undefined
   */
  async getProviderByIdentity(identity: string) {
    return this.dbClient.db.query.providersTable.findFirst({
      where: eq(providersTable.identity, identity),
    });
  }
}
