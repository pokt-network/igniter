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

  async listAll() {
    return this.dbClient.db
      .select()
      .from(providersTable)
  }

  async upsertFromGovernance(
    providers: Array<{ name: string; identity: string; identityHistory: string[]; url: string }>,
    updatedBy: string,
  ) {
    const current = await this.listAll()
    const currentMap = new Map(current.map((p) => [p.identity, p]))

    const allCdnIdentities = new Set<string>()
    for (const p of providers) {
      allCdnIdentities.add(p.identity)
      p.identityHistory.forEach((h) => allCdnIdentities.add(h))
    }

    let inserted = 0
    let updated = 0
    let disabled = 0

    await this.dbClient.db.transaction(async (tx) => {
      for (const cdnProvider of providers) {
        const possibleIds = [cdnProvider.identity, ...cdnProvider.identityHistory]
        const matchingCurrent = possibleIds.map((id) => currentMap.get(id)).find(Boolean) ?? null

        if (matchingCurrent) {
          const shouldUpdateIdentity = matchingCurrent.identity !== cdnProvider.identity
          const shouldUpdateName = matchingCurrent.name !== cdnProvider.name
          const shouldUpdateUrl = matchingCurrent.url !== cdnProvider.url

          if (shouldUpdateIdentity || shouldUpdateName || shouldUpdateUrl) {
            await tx
              .update(providersTable)
              .set({
                identity: cdnProvider.identity,
                name: cdnProvider.name,
                url: cdnProvider.url,
                updatedBy,
              })
              .where(eq(providersTable.id, matchingCurrent.id))
            updated++
          }
        } else {
          await tx.insert(providersTable).values({
            name: cdnProvider.name,
            identity: cdnProvider.identity,
            url: cdnProvider.url,
            enabled: true,
            visible: true,
            createdBy: updatedBy,
            updatedBy,
          })
          inserted++
        }
      }

      for (const provider of current) {
        if (!allCdnIdentities.has(provider.identity) && (provider.enabled || provider.visible)) {
          await tx
            .update(providersTable)
            .set({ enabled: false, visible: false, updatedAt: new Date(), updatedBy })
            .where(eq(providersTable.identity, provider.identity))
          disabled++
        }
      }
    })

    return { inserted, updated, disabled }
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
