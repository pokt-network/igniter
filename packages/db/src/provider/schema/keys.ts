import crypto from 'crypto'
import {
  bigint,
  customType,
  integer,
  json,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { SupplierServiceConfig } from '@igniter/pocket'
import {
  addressStateEnum,
  KeyState,
  RemediationHistoryEntryReason,
  TransactionResult,
} from './enums'
import {AddressGroup, AddressGroupWithDetails, addressGroupTable} from './addressGroup'
import {Delegator, delegatorsTable} from './delegator'

const algorithm = 'aes-256-cbc'

/**
 * Encrypts the provided text using AES encryption with a predefined initialization vector (IV)
 * and encryption key sourced from the environment variables.
 *
 * @param {string} text - The plain text string to be encrypted.
 * @return {string} The encrypted string, formatted as `IV:encryptedText`.
 */
export function encrypt(text: string): string {
  const iv = Buffer.from(process.env.ENCRYPTION_IV!, 'hex')
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

/**
 * Decrypts the provided encrypted text using the predefined encryption key.
 *
 * @param {string} text - The encrypted text in the format "iv:encryptedData",
 *                         where "iv" is the initialization vector and
 *                         "encryptedData" is the ciphertext.
 * @return {string} The decrypted plain text.
 */
export function decrypt(text: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const textParts = text.split(':')
  const iv = Buffer.from(textParts.shift()!, 'hex')
  const encryptedText = Buffer.from(textParts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encryptedText, undefined, 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Represents an encrypted text type with custom serialization and deserialization logic.
 *
 * This variable implements a custom type for handling encrypted strings.
 * It defines methods for transforming the data to and from a driver-compatible format,
 * using encryption and decryption mechanisms.
 *
 * The `dataType` method specifies the type of data as 'text'.
 * The `fromDriver` method handles decryption when retrieving data from the driver.
 * The `toDriver` method handles encryption when sending data to the driver.
 *
 * Note that the actual encryption and decryption logic relies on the `encrypt` and `decrypt` functions.
 */
const encryptedText = customType<{ data: string }>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown) {
    return decrypt(value as string)
  },
  toDriver(value: string) {
    return encrypt(value)
  },
})

/**
 * Represents the `keys` table in the database.
 *
 * This table stores information related to cryptographic keys and their associated metadata.
 *
 * @property {number} id - The primary key for the table. Automatically generated identity column.
 * @property {string} address - A unique, non-nullable string representing the address associated with the key. Maximum length: 255.
 * @property {string} publicKey - A unique, non-nullable string representing the public key. Maximum length: 66.
 * @property {string} privateKey - An encrypted representation of the private key. Non-nullable.
 * @property {string} [ownerAddress] - An optional string representing the address of the owner. Defaults to an empty string. Will be updated to non-nullable in the future after data sanitization.
 * @property {KeyState} state - An enumeration representing the state of the address. Defaults to `KeyState.Available`.
 * @property {RemediationHistoryEntry[]} remediationHistory - JSON field representing the remediation history of the key. Defaults to an empty array.
 * @property {Date | null} deliveredAt - A timestamp indicating when the key was delivered. Nullable.
 * @property {string | null} deliveredTo - A foreign key referencing the `identity` column in the `delegators` table, representing the identity of the delegator the key was delivered to. Nullable.
 * @property {number | null} addressGroupId - A foreign key referencing the `id` column in the `addressGroup` table, representing the ID of the associated address group. Nullable.
 * @property {number} delegatorRevSharePercentage - An integer indicating the revenue share percentage requested by the intermediary. Defaults to 0.
 * @property {string} delegatorRewardsAddress - A string representing the address of the intermediary. Defaults to an empty string.
 * @property {Date} createdAt - A timestamp indicating when this record was created. Defaults to the current timestamp.
 * @property {Date} updatedAt - A timestamp indicating when this record was last updated. Automatically updates to the current timestamp whenever the record is modified.
 * @property {number} lastUpdatedHeight - An integer representing the last blockchain height at which this record was updated. Used to prevent updates with lower height values. Defaults to 0.
 * @property {string} stakeOwner - A string representing the owner of the staked tokens. Defaults to an empty string.
 * @property {bigint} stakeAmountUpokt - A bigint indicating the amount of tokens staked (in upokt). Defaults to 0n.
 * @property {bigint} balanceUpokt - A bigint indicating the balance of the address (in upokt). Defaults to 0n.
 * @property {SupplierServiceConfig[]} services - JSON field representing the supplier service configurations for the key. Defaults to an empty array.
 */
export const keysTable = pgTable('keys', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  address: varchar({ length: 255 }).unique().notNull(),
  publicKey: varchar({ length: 66 }).unique().notNull(),
  privateKey: encryptedText('privateKey').notNull(),
  // TODO: make it not null once all data is sanitized. See: https://github.com/stake-igniter/igniter/issues/109
  ownerAddress: varchar({ length: 255 }).default(''),
  state: addressStateEnum().notNull().default(KeyState.Available),
  remediationHistory: json('remediationHistory').$type<RemediationHistoryEntry[]>().default([]),
  deliveredAt: timestamp(),
  deliveredTo: varchar('delegator_identity').references(() => delegatorsTable.identity),
  addressGroupId: integer('address_group_id').references(() => addressGroupTable.id),
  delegatorRevSharePercentage: integer().default(0),
  delegatorRewardsAddress: varchar({ length: 255 }).default(''),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  // metadata coming from the blockchain
  lastUpdatedHeight: integer().default(0), // prevent updating this record with values of a lower height
  stakeOwner: varchar({ length: 255 }).default(''),
  stakeAmountUpokt: bigint({ mode: 'bigint' }).default(0n),
  balanceUpokt: bigint({ mode: 'bigint' }).default(0n),
  services: json('services').$type<SupplierServiceConfig[]>().default([]),
})

/**
 * Represents the relationships within the `keysTable` to other database tables.
 *
 * The `keysRelations` object defines the associations between the `keysTable` and:
 * - `addressGroupTable`: Establishes a one-to-one relationship based on the `addressGroupId` field from the `keysTable` and the `id` field from the `addressGroupTable`.
 * - `delegatorsTable`: Establishes a one-to-one relationship based on the `deliveredTo` field from the `keysTable` and the `identity` field from the `delegatorsTable`.
 *
 * This mapping is used for querying related data between the `keysTable` and its associated tables.
 */
export const keysRelations = relations(keysTable, ({ one }) => ({
  addressGroup: one(addressGroupTable, {
    fields: [keysTable.addressGroupId],
    references: [addressGroupTable.id],
  }),
  delegator: one(delegatorsTable, {
    fields: [keysTable.deliveredTo],
    references: [delegatorsTable.identity],
  }),
}))

/**
 * Represents a type definition for a `Key` derived from the structure of `keysTable.$inferSelect`.
 *
 * This type is a utility type that infers the structure of the selected key from the given table.
 * It is primarily used to ensure type safety when working with key-based operations in the context of the application.
 *
 * This type is generated dynamically based on the schema of `keysTable`.
 */
export type Key = typeof keysTable.$inferSelect;

/**
 * Type alias representing the inferred type for inserting data into the keys table.
 *
 * `InsertKey` is used to define the shape of data required when performing an
 * insert operation in the `keysTable`. It is derived from the `$inferInsert`
 * property to ensure consistency with the table's schema.
 */
export type InsertKey = typeof keysTable.$inferInsert;

export type KeyWithRelations = Omit<Key, 'privateKey'> & {
  addressGroup: AddressGroup | null;
  delegator: Delegator | null;
};

/**
 * Represents a Key with its associated AddressGroup details.
 * Used primarily in workflow activities for supplier operations.
 */
export type KeyWithGroup = Key & {
  addressGroup?: AddressGroupWithDetails | null;
};


/**
 * Represents an entry in the remediation history, which tracks specific actions or events occurring
 * within a remediation process. Each entry includes a descriptive message, a code indicating the type of event,
 * and a timestamp for when the event occurred.
 *
 * @interface RemediationHistoryEntry
 */
export interface RemediationHistoryEntry {
  message: string;
  reason: RemediationHistoryEntryReason;
  details?: string;
  txResult?: TransactionResult;
  txResultDetails?: string;
  timestamp: number;
}
