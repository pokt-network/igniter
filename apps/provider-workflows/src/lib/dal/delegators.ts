import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import { delegatorsTable } from '@igniter/db/provider/schema'
import { eq } from 'drizzle-orm'

export default class Delegators {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async listAll() {
    return this.dbClient.db
      .select()
      .from(delegatorsTable)
  }

  async upsertFromGovernance(
    delegators: Array<{ name: string; identity: string; identityHistory: string[] }>,
    updatedBy: string,
  ) {
    const current = await this.listAll()
    const currentMap = new Map(current.map((d) => [d.identity, d]))

    const allCdnIdentities = new Set<string>()
    for (const d of delegators) {
      allCdnIdentities.add(d.identity)
      d.identityHistory.forEach((h) => allCdnIdentities.add(h))
    }

    let inserted = 0
    let updated = 0
    let disabled = 0

    await this.dbClient.db.transaction(async (tx) => {
      for (const cdnDelegator of delegators) {
        const possibleIds = [cdnDelegator.identity, ...cdnDelegator.identityHistory]
        const matchingCurrent = possibleIds.map((id) => currentMap.get(id)).find(Boolean) ?? null

        if (matchingCurrent) {
          const shouldUpdateIdentity = matchingCurrent.identity !== cdnDelegator.identity
          const shouldUpdateName = matchingCurrent.name !== cdnDelegator.name

          if (shouldUpdateIdentity || shouldUpdateName) {
            await tx
              .update(delegatorsTable)
              .set({
                identity: cdnDelegator.identity,
                name: cdnDelegator.name,
                updatedBy,
              })
              .where(eq(delegatorsTable.id, matchingCurrent.id))
            updated++
          }
        } else {
          await tx.insert(delegatorsTable).values({
            name: cdnDelegator.name,
            identity: cdnDelegator.identity,
            createdBy: updatedBy,
            updatedBy,
            enabled: true,
          })
          inserted++
        }
      }

      for (const delegator of current) {
        if (!allCdnIdentities.has(delegator.identity) && delegator.enabled) {
          await tx
            .update(delegatorsTable)
            .set({ enabled: false, updatedAt: new Date(), updatedBy })
            .where(eq(delegatorsTable.identity, delegator.identity))
          disabled++
        }
      }
    })

    return { inserted, updated, disabled }
  }
}
