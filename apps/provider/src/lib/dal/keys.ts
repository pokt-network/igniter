import type {
  InsertKey,
  Key, KeyWithRelations,
} from '@igniter/db/provider/schema'
import * as schema from '@igniter/db/provider/schema'
import { getDbClient } from '@/db'
import { KeyState } from '@igniter/db/provider/enums'
import { PgTransaction } from 'drizzle-orm/pg-core'
import {
  and,
  count,
  eq,
  inArray,
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
