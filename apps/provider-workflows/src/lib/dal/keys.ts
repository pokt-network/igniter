import type {DBClient} from '@igniter/db/connection'
import {asc} from 'drizzle-orm/sql/expressions/select'
import {notInArray, sql} from 'drizzle-orm'
import {
  and,
  eq,
  gt,
  lte,
  ne,
} from 'drizzle-orm/sql/expressions/conditions'
import * as schema from '@igniter/db/provider/schema'
import {
  Key,
  keysTable,
  addressGroupTable,
  KeyWithGroup,
} from '@igniter/db/provider/schema'
import {KeyState, RemediationHistoryEntryReason} from '@igniter/db/provider/enums'
import type {Logger} from '@igniter/logger'

export type KeysMinMax = { total: number, minId: number, maxId: number }

export type { KeyWithGroup }

/**
 * Represents a utility class for performing operations related to "keys" in the system.
 * Provides methods for querying information about keys from the database and implementing key-related logic.
 */
export default class Keys {
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

  async loadKey(address: string): Promise<KeyWithGroup | undefined> {
    this.logger.debug('loadKey: Execution Started', {address});
    const key = await this.dbClient.db.query.keysTable.findFirst({
      where: eq(keysTable.address, address),
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
                  WHERE ${keysTable}."address_group_id" = ${addressGroupTable.id}
                ) AS INTEGER
              )
            `.as('keys_count'),
          },
        },
      },
    });

    if (!key) {
      this.logger.warn('loadKey: Execution Finished. Key not found.', {address});
      return undefined;
    }

    this.logger.debug('loadKey: Execution Finished', {address});
    return key;
  }

  /**
   * Retrieves the total count of keys, as well as the minimum and maximum key IDs from the database.
   *
   * @return {Promise<KeysMinMax>}
   * A promise that resolves to an object containing the total count of keys,
   * the minimum key ID, and the maximum key ID. If the query returns no rows,
   * the result will contain 0 for `total` and `minId`, and `maxId` will be null.
   */
  async getKeysMinAndMax(): Promise<KeysMinMax> {
    this.logger.debug('getKeysMinAndMax: Execution Started')
    const rows = await this.dbClient.db
      .select({
        total: sql<number>`count(*)::int`.as('total'),
        minId: sql<number | null>`min(${schema.keysTable.id})::int`.as('minId'),
        maxId: sql<number | null>`max(${keysTable.id})::int`.as('maxId'),
      })
      .from(keysTable)

    if (!rows || rows.length === 0) {
      this.logger.debug('getKeysMinAndMax: Execution Finished', {total: 0, minId: 0, maxId: 0})
      return {total: 0, minId: 0, maxId: 0}
    }

    this.logger.debug('getKeysMinAndMax: Execution Finished', {...rows[0]})
    return rows[0] as KeysMinMax
  }

  /**
   * Fetches a range of keys based on the provided ID parameters and state conditions.
   *
   * @param {number} afterId - The starting ID (exclusive). If null, starts from the smallest possible ID.
   * @param {number} endId - The ending ID (inclusive).
   * @param states - The list of key states to filter by.
   * @return {Promise<any>} A promise that resolves to the list of keys with their IDs and addresses
   *                        that match the conditions.
   */
  async loadKeysInRange(afterId: number, endId: number, states: KeyState[]): Promise<any> {
    afterId = afterId - 1

    this.logger.debug('loadKeysInRange: Execution Started', {afterId, endId})

    const where = and(
      afterId === null ? gt(keysTable.id, -2147483648) : gt(keysTable.id, afterId),
      lte(keysTable.id, endId),
      notInArray(keysTable.state, states),
    )

    const result = this.dbClient.db
      .select({id: keysTable.id, address: keysTable.address})
      .from(keysTable)
      .where(where)
      .orderBy(asc(keysTable.id))

    this.logger.debug('loadKeysInRange: Execution Finished', {afterId, endId})

    return result
  }

  /**
   * Updates the key information for the specified address in the database.
   *
   * @param {string} address - The unique identifier of the key to be updated.
   * @param {Partial<schema.InsertKey>} update - The partial object containing the key properties to be updated.
   * @param {number} [lastUpdatedHeight=-1] - The maximum last updated height to consider for updates. Defaults to -1.
   * @return {Promise<any>} A promise that resolves when the update operation is complete.
   */
  async updateKey(address: string, update: Partial<schema.InsertKey>, lastUpdatedHeight: number = -1): Promise<any> {
    this.logger.debug('updateKey: Execution Started', {address, update, lastUpdatedHeight})
    const result = this.dbClient.db.update(keysTable)
      .set(update)
      .where(
        and(
          lte(keysTable.lastUpdatedHeight, lastUpdatedHeight),
          eq(keysTable.address, address),
        ),
      )
    this.logger.debug('updateKey: Execution Finished', {address, update, lastUpdatedHeight})
    return result
  }
}
