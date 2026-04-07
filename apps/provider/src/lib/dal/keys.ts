import type {
  InsertKey,
  Key, KeyWithRelations, KeyWithGroup,
  RemediationHistoryEntry,
} from '@igniter/db/provider/schema'
import * as schema from '@igniter/db/provider/schema'
import { getDbClient } from '@/db'
import { KeyState, RemediationHistoryEntryReason } from '@igniter/db/provider/enums'
import { PgTransaction } from 'drizzle-orm/pg-core'
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm'
import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'

const { keysTable } = schema

/**
 * Inserts multiple keys into the database using a transaction.
 * If any insertion fails, the entire transaction is rolled back.
 * @param keys - Array of keys to insert
 * @returns The inserted keys
 */
export async function insertMany(keys: InsertKey[]): Promise<InsertKey[]> {
  const dbClient = getDbClient()
  const existingKey = await dbClient.db.query.keysTable.findFirst({
    where: ((keysTable, { inArray }) => inArray(keysTable.address, keys.map(k => k.address))),
  })

  // why not just "ignore" them or return them instead.
  if (existingKey) {
    throw new Error('There are keys that already exists')
  }

  return dbClient.db.transaction(async (tx) => {
    const insertedKeys = await tx
      .insert(keysTable)
      .values(keys)
      .returning()

    if (!insertedKeys.length || insertedKeys.length !== keys.length) {
      throw new Error('Failed to insert all keys')
    }

    return insertedKeys
  })
}

/**
 * Updates keys that match the given addresses and delegator identity
 * from 'Delivered' state to 'Available' state and clears delivery information.
 *
 * @param addresses - Array of addresses to update
 * @param delegatorIdentity - The delegator identity who currently has the keys
 * @returns The number of keys that were updated
 */
export async function markAvailable(addresses: string[], delegatorIdentity: string) {
  const dbClient = getDbClient()
  return dbClient.db.update(keysTable)
    .set({
      state: KeyState.Available,
      deliveredAt: null,
      deliveredTo: null,
      ownerAddress: null,
    })
    .where(
      and(
        inArray(keysTable.address, addresses),
        eq(keysTable.deliveredTo, delegatorIdentity),
        eq(keysTable.state, KeyState.Delivered),
      ),
    )
    .returning({ address: keysTable.address })
}

export async function listKeysWithPk() : Promise<KeyWithRelations[]> {
  const dbClient = getDbClient()
  return dbClient.db.query.keysTable.findMany({
    columns: {
      privateKey: false,
    },
    with: {
      addressGroup: true,
      delegator: true,
    },
  })
}

export async function countPrivateKeysByAddressGroup(addressGroupId: number, state?: KeyState) {
  const dbClient = getDbClient()
  const filters = []

  if (addressGroupId) {
    filters.push(eq(keysTable.addressGroupId, addressGroupId))
  }

  if (state) {
    filters.push(eq(keysTable.state, state))
  }

  const [result] = await dbClient.db.select({
    count: count(),
  })
    .from(keysTable)
    .where(filters.length > 0 ? and(...filters) : undefined)

  return Number(result?.count || 0)
}


export async function listPrivateKeysByAddressGroup(addressGroupId: number, state?: KeyState) {
  const dbClient = getDbClient()
  const filters = []

  if (addressGroupId) {
    filters.push(eq(keysTable.addressGroupId, addressGroupId))
  }

  if (state) {
    filters.push(eq(keysTable.state, state))
  }

  return dbClient.db.query.keysTable.findMany({
    ...(filters.length > 0 && { where: and(...filters) }),
    columns: {
      privateKey: true,
    },
  })
}

export async function listStakedAddresses() {
  const dbClient = getDbClient()
  return await dbClient.db.query.keysTable.findMany({
    where: ((keysTable, { eq }) => eq(keysTable.state, KeyState.Staked)),
    columns: {
      address: true,
    },
  }).then(keys => keys.map(key => key.address))
}


/**
 * Atomically lock up to `count` Available keys for update,
 * skipping those already locked by concurrent txns.
 */
export async function lockAvailableKeys(
  tx: PgTransaction<NodePgQueryResultHKT, typeof schema>,
  addressGroupId: number,
  count: number,
): Promise<Key[]> {
  return tx
    .select()
    .from(keysTable)
    .where(
      and(
        eq(keysTable.addressGroupId, addressGroupId),
        eq(keysTable.state, KeyState.Available),
      ),
    )
    .limit(count)
    .for('update', { skipLocked: true })
}

/**
 * UPDATE those rows to Delivered and set deliveredTo/At
 * Returns the updated rows.
 */
export async function markKeysDelivered(
  tx: PgTransaction<NodePgQueryResultHKT>,
  keyIds: number[],
  deliveredTo: string,
  ownerAddress: string,
  delegatorRevSharePercentage: number,
  delegatorRewardsAddress: string
): Promise<Key[]> {
  if (!keyIds.length) return []
  if (!ownerAddress) throw new Error('ownerAddress is required when delivering keys')
  if (!deliveredTo) throw new Error('deliveredTo (delegator identity) is required when delivering keys')
  return tx
    .update(keysTable)
    .set({
      state: KeyState.Delivered,
      deliveredTo,
      deliveredAt: new Date(),
      ownerAddress,
      delegatorRevSharePercentage,
      delegatorRewardsAddress,
    })
    .where(inArray(keysTable.id, keyIds))
    .returning()
}

export async function markStaked(addresses: string[], delegatorIdentity: string) {
  const dbClient = getDbClient()
  return dbClient.db.update(keysTable)
    .set({
      state: KeyState.Staked,
    })
    .where(
      and(
        inArray(keysTable.address, addresses),
        eq(keysTable.deliveredTo, delegatorIdentity),
        eq(keysTable.state, KeyState.Delivered),
      ),
    )
    .returning({ address: keysTable.address })
}

export async function markUnstaking(addresses: string[], delegatorIdentity: string) {
  const dbClient = getDbClient()
  return dbClient.db.update(keysTable)
    .set({
      state: KeyState.Unstaking,
    })
    .where(
      and(
        inArray(keysTable.address, addresses),
        eq(keysTable.deliveredTo, delegatorIdentity),
        inArray(keysTable.state, [KeyState.Staked, KeyState.AttentionNeeded, KeyState.RemediationFailed]),
      ),
    )
    .returning({ address: keysTable.address })
}

/**
 * INSERT new keys, returning the full rows
 */
export async function insertNewKeys(
  tx: PgTransaction<NodePgQueryResultHKT>,
  newKeys: InsertKey[],
): Promise<Key[]> {
  if (!newKeys.length) return []
  const inserted = await tx
    .insert(keysTable)
    .values(newKeys)
    .returning()
  if (inserted.length !== newKeys.length) {
    throw new Error('Failed to insert all new keys')
  }
  return inserted
}

/**
 * Updates the rewards settings for a specified Key in the database.
 *
 * @param {Key['id']} id - The unique identifier for the key to update.
 * @param {Object} delegatorRewards - An object containing the fields to update.
 * @param {string} delegatorRewards.delegatorRewardsAddress - The delegator's rewards address to update.
 * @param {number} delegatorRewards.delegatorRevSharePercentage - The delegator's revenue share percentage to update.
 */
export async function updateRewardsSettings(
  id: Key['id'],
  delegatorRewards: Pick<Key, 'delegatorRewardsAddress' | 'delegatorRevSharePercentage'>
) {
  const dbClient = getDbClient()
  await dbClient.db.update(keysTable)
    .set(delegatorRewards)
    .where(eq(keysTable.id, id))
    .returning()
}

export async function updateKeysState(ids: number[], state: KeyState) {
  const dbClient = getDbClient()
  await dbClient.db.update(keysTable)
    .set({
      state,
    })
    .where(inArray(keysTable.id, ids))
}

export async function updateKeysStateWhereCurrentStateIn(currentStates: KeyState[], newState: KeyState) {
  const dbClient = getDbClient()
  await dbClient.db.update(keysTable)
    .set({
      state: newState,
    })
    .where(inArray(keysTable.state, currentStates))
}

/**
 * Lists all keys in `Staked` state with deep address group relations,
 * including addressGroupServices (with service and endpoints),
 * and relayMiner (with region).
 *
 * This mirrors the deep loading pattern from the workflow DAL's `loadKey` function.
 */
export async function listStakedKeysWithDetails(): Promise<KeyWithGroup[]> {
  const dbClient = getDbClient()
  return dbClient.db.query.keysTable.findMany({
    where: eq(keysTable.state, KeyState.Staked),
    with: {
      addressGroup: {
        with: {
          relayMiner: {
            columns: {
              id: true,
              name: true,
              identity: true,
              regionId: true,
              domain: true,
              createdAt: true,
              updatedAt: true,
              createdBy: true,
              updatedBy: true,
            },
            with: {
              region: true,
            },
          },
          addressGroupServices: {
            with: {
              service: {
                columns: {
                  name: true,
                  endpoints: true,
                },
              },
            },
          },
        },
        extras: {
          keysCount: sql<number>`
            CAST(
              (
                SELECT COUNT(*)
                FROM ${keysTable}
                WHERE ${keysTable}."address_group_id" = ${schema.addressGroupTable.id}
              ) AS INTEGER
            )
          `.as('keys_count'),
        },
      },
    },
  })
}

/**
 * Batch update remediationHistory for multiple keys by address.
 */
export async function batchUpdateRemediationHistory(
  updates: Array<{ address: string; remediationHistory: RemediationHistoryEntry[] }>,
): Promise<void> {
  const dbClient = getDbClient()
  await dbClient.db.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(keysTable)
        .set({ remediationHistory: update.remediationHistory })
        .where(eq(keysTable.address, update.address))
    }
  })
}

/**
 * Load keys by addresses with deep address group relations.
 */
export async function countKeys(): Promise<number> {
  const dbClient = getDbClient()
  const [{ value }] = await dbClient.db.select({ value: count() }).from(keysTable)
  return value
}

export async function getPrivateKeyById(keyId: number): Promise<string | null> {
  const dbClient = getDbClient()
  const result = await dbClient.db.query.keysTable.findFirst({
    where: eq(keysTable.id, keyId),
    columns: { privateKey: true },
  })
  return result?.privateKey ?? null
}

export async function getKeysSummary(): Promise<{ totalKeys: number; stakedKeys: number; availableKeys: number; totalStakedUpokt: number }> {
  const dbClient = getDbClient()
  const result = await dbClient.db
    .select({
      totalKeys: count(),
      stakedKeys: sql<number>`count(*) filter (where state = ${KeyState.Staked})`,
      availableKeys: sql<number>`count(*) filter (where state = ${KeyState.Available} or state = ${KeyState.Imported})`,
      totalStakedUpokt: sql<number>`coalesce(sum("stakeAmountUpokt") filter (where state = ${KeyState.Staked}), 0)`,
    })
    .from(keysTable)

  return {
    totalKeys: result[0]?.totalKeys ?? 0,
    stakedKeys: result[0]?.stakedKeys ?? 0,
    availableKeys: result[0]?.availableKeys ?? 0,
    totalStakedUpokt: Number(result[0]?.totalStakedUpokt ?? 0),
  }
}

export async function listKeysByAddresses(addresses: string[]): Promise<KeyWithGroup[]> {
  if (addresses.length === 0) return []
  const dbClient = getDbClient()
  return dbClient.db.query.keysTable.findMany({
    where: inArray(keysTable.address, addresses),
    with: {
      addressGroup: {
        with: {
          relayMiner: {
            columns: {
              id: true,
              name: true,
              identity: true,
              regionId: true,
              domain: true,
              createdAt: true,
              updatedAt: true,
              createdBy: true,
              updatedBy: true,
            },
            with: {
              region: true,
            },
          },
          addressGroupServices: {
            with: {
              service: {
                columns: {
                  name: true,
                  endpoints: true,
                },
              },
            },
          },
        },
        extras: {
          keysCount: sql<number>`
            CAST(
              (
                SELECT COUNT(*)
                FROM ${keysTable}
                WHERE ${keysTable}."address_group_id" = ${schema.addressGroupTable.id}
              ) AS INTEGER
            )
          `.as('keys_count'),
        },
      },
    },
  })
}

export interface KeyExportFilters {
  addressGroupId?: number
  states?: KeyState[]
  ownerAddress?: string
  delegatorIdentity?: string
  dateFrom?: Date
  dateTo?: Date
  dateField?: 'createdAt' | 'deliveredAt'
  exportStatus?: 'not_exported' | 'previously_exported' | 'all'
}

function buildExportFilterConditions(filters: KeyExportFilters): SQL[] {
  const conditions: SQL[] = []

  if (filters.addressGroupId) {
    conditions.push(eq(keysTable.addressGroupId, filters.addressGroupId))
  }

  if (filters.states && filters.states.length > 0) {
    conditions.push(inArray(keysTable.state, filters.states))
  }

  if (filters.ownerAddress) {
    conditions.push(eq(keysTable.ownerAddress, filters.ownerAddress))
  }

  if (filters.delegatorIdentity) {
    conditions.push(eq(keysTable.deliveredTo, filters.delegatorIdentity))
  }

  const dateColumn = filters.dateField === 'deliveredAt' ? keysTable.deliveredAt : keysTable.createdAt

  if (filters.dateFrom) {
    conditions.push(gte(dateColumn, filters.dateFrom))
  }

  if (filters.dateTo) {
    conditions.push(lte(dateColumn, filters.dateTo))
  }

  if (filters.exportStatus === 'not_exported') {
    conditions.push(isNull(keysTable.exportedAt))
  } else if (filters.exportStatus === 'previously_exported') {
    conditions.push(isNotNull(keysTable.exportedAt))
  }

  return conditions
}

export async function countKeysForExport(filters: KeyExportFilters): Promise<number> {
  const dbClient = getDbClient()
  const conditions = buildExportFilterConditions(filters)

  const [result] = await dbClient.db.select({ count: count() })
    .from(keysTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)

  return Number(result?.count || 0)
}

export async function listKeysForExport(filters: KeyExportFilters) {
  const dbClient = getDbClient()
  const conditions = buildExportFilterConditions(filters)

  return dbClient.db.query.keysTable.findMany({
    ...(conditions.length > 0 && { where: and(...conditions) }),
    columns: {
      id: true,
      address: true,
      privateKey: true,
    },
  })
}

export async function markKeysExported(keyIds: number[]): Promise<void> {
  if (keyIds.length === 0) return
  const dbClient = getDbClient()
  await dbClient.db.update(keysTable)
    .set({
      exportedAt: new Date(),
      exportCount: sql`COALESCE(${keysTable.exportCount}, 0) + 1`,
    })
    .where(inArray(keysTable.id, keyIds))
}

export interface KeyMigrationFilters {
  keyIds?: number[]
  addressGroupId?: number
  states?: KeyState[]
  ownerAddress?: string
  delegatorIdentity?: string
}

function buildMigrationFilterConditions(filters: KeyMigrationFilters): SQL[] {
  const conditions: SQL[] = []

  if (filters.keyIds && filters.keyIds.length > 0) {
    conditions.push(inArray(keysTable.id, filters.keyIds))
  }

  if (filters.addressGroupId) {
    conditions.push(eq(keysTable.addressGroupId, filters.addressGroupId))
  }

  if (filters.states && filters.states.length > 0) {
    conditions.push(inArray(keysTable.state, filters.states))
  }

  if (filters.ownerAddress) {
    conditions.push(eq(keysTable.ownerAddress, filters.ownerAddress))
  }

  if (filters.delegatorIdentity) {
    conditions.push(eq(keysTable.deliveredTo, filters.delegatorIdentity))
  }

  return conditions
}

export async function countKeysForMigration(filters: KeyMigrationFilters): Promise<number> {
  const dbClient = getDbClient()
  const conditions = buildMigrationFilterConditions(filters)

  const [result] = await dbClient.db.select({ count: count() })
    .from(keysTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)

  return Number(result?.count || 0)
}

export async function listKeysForMigration(filters: KeyMigrationFilters): Promise<Array<{
  id: number
  address: string
  addressGroupId: number | null
  state: KeyState
  remediationHistory: RemediationHistoryEntry[] | null
}>> {
  const dbClient = getDbClient()
  const conditions = buildMigrationFilterConditions(filters)

  return dbClient.db.query.keysTable.findMany({
    ...(conditions.length > 0 && { where: and(...conditions) }),
    columns: {
      id: true,
      address: true,
      addressGroupId: true,
      state: true,
      remediationHistory: true,
    },
  })
}

const MIGRATION_CHUNK_SIZE = 500

export async function migrateKeysToAddressGroup(keyIds: number[], targetAddressGroupId: number): Promise<number> {
  if (keyIds.length === 0) return 0
  const dbClient = getDbClient()

  const now = Date.now()
  const migrationEntry: RemediationHistoryEntry = {
    message: `Key migrated to address group ${targetAddressGroupId}`,
    reason: RemediationHistoryEntryReason.AddressGroupMigration,
    timestamp: now,
  }

  await dbClient.db.transaction(async (tx) => {
    for (let i = 0; i < keyIds.length; i += MIGRATION_CHUNK_SIZE) {
      const chunkIds = keyIds.slice(i, i + MIGRATION_CHUNK_SIZE)

      const keys = await tx
        .select({ id: keysTable.id, state: keysTable.state, remediationHistory: keysTable.remediationHistory })
        .from(keysTable)
        .where(inArray(keysTable.id, chunkIds))

      const stateResetIds: number[] = []
      const historyCaseChunks: SQL[] = []

      for (const key of keys) {
        const history = [...((key.remediationHistory as RemediationHistoryEntry[]) ?? [])]
        const existingIndex = history.findIndex((item) => item.reason === migrationEntry.reason)
        if (existingIndex !== -1) {
          history[existingIndex] = migrationEntry
        } else {
          history.push(migrationEntry)
          history.sort((a, b) => b.timestamp - a.timestamp)
        }
        historyCaseChunks.push(sql`WHEN ${keysTable.id} = ${key.id} THEN ${JSON.stringify(history)}::json`)

        if ([KeyState.AttentionNeeded, KeyState.RemediationFailed].includes(key.state)) {
          stateResetIds.push(key.id)
        }
      }

      const historyCase = sql`CASE ${sql.join(historyCaseChunks, sql` `)} ELSE ${keysTable.remediationHistory} END`

      await tx
        .update(keysTable)
        .set({ addressGroupId: targetAddressGroupId, remediationHistory: historyCase })
        .where(inArray(keysTable.id, chunkIds))

      if (stateResetIds.length > 0) {
        await tx
          .update(keysTable)
          .set({ state: KeyState.Staked })
          .where(inArray(keysTable.id, stateResetIds))
      }
    }
  })

  return keyIds.length
}

export async function listDistinctOwnerAddresses(): Promise<string[]> {
  const dbClient = getDbClient()
  const results = await dbClient.db
    .selectDistinct({ ownerAddress: keysTable.ownerAddress })
    .from(keysTable)
    .where(and(isNotNull(keysTable.ownerAddress), ne(keysTable.ownerAddress, '')))

  return results
    .map(r => r.ownerAddress)
    .filter((addr): addr is string => Boolean(addr))
}
