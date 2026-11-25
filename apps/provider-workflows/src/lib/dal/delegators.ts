import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import { delegatorsTable } from '@igniter/db/provider/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

// Column limits of delegatorsTable (name varchar 255, identity varchar 66).
const nameSchema = z.string().min(1).max(255)
const identitySchema = z.string().min(1).max(66)

/** The delegators governance (CDN) payload; the same shape as apps/provider/src/lib/dal/delegators.ts. */
const cdnDelegatorsSchema = z.array(z.object({
  name: nameSchema,
  identity: identitySchema,
  identityHistory: z.array(identitySchema),
}))

export type CdnDelegator = z.infer<typeof cdnDelegatorsSchema>[number]

/**
 * Validates the delegators governance (CDN) payload and returns only the known fields.
 * Throws on an invalid payload, so a malformed one writes nothing (a partly accepted list would
 * drive the disable pass below).
 */
export function parseCdnDelegators(payload: unknown): CdnDelegator[] {
  const parsed = cdnDelegatorsSchema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid delegators payload: ${issue?.path.join('.') || 'root'}: ${issue?.message}`)
  }
  return parsed.data
}

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

  /**
   * Applies the governance (CDN) list to the delegators table:
   * - the payload is validated first (parseCdnDelegators); an invalid one throws before any write;
   * - new delegators are inserted DISABLED, until the owner enables them in the UI;
   * - the identity of an ENABLED row is never rotated from the CDN; a warning is logged instead
   *   (the owner disables the row, the next sync rotates it, the owner re-enables it);
   * - rows no longer listed are disabled.
   */
  async upsertFromGovernance(
    payload: unknown,
    updatedBy: string,
  ) {
    const delegators = parseCdnDelegators(payload)
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
          const identityChanged = matchingCurrent.identity !== cdnDelegator.identity
          const shouldUpdateIdentity = identityChanged && !matchingCurrent.enabled
          const shouldUpdateName = matchingCurrent.name !== cdnDelegator.name

          if (identityChanged && matchingCurrent.enabled) {
            this.logger.warn('Governance lists a new identity for an enabled delegator; not rotating it', {
              delegatorId: matchingCurrent.id,
              name: matchingCurrent.name,
              currentIdentity: matchingCurrent.identity,
              governanceIdentity: cdnDelegator.identity,
            })
          }

          if (shouldUpdateIdentity || shouldUpdateName) {
            await tx
              .update(delegatorsTable)
              .set({
                ...(shouldUpdateIdentity ? { identity: cdnDelegator.identity } : {}),
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
            // Disabled until the owner approves it in the UI.
            enabled: false,
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
