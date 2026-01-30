import {
  boolean,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { usersTable } from './user'
import { chainIdEnum } from './enums'

/**
 * Represents the database table `application_settings` and its schema definition.
 * This table stores configuration and metadata for applications in the system.
 *
 * Fields:
 * - `id`: The unique identifier for each application setting. It is auto-generated and serves as the primary key.
 * - `name`: The name of the application setting, limited to a maximum of 255 characters.
 * - `appIdentity`: A unique identity string for the application, required and limited to 66 characters.
 * - `supportEmail`: The support email address for the application, limited to a maximum of 255 characters.
 * - `ownerIdentity`: The identity of the application owner, required and limited to 255 characters.
 * - `ownerEmail`: The email address of the application owner, limited to 255 characters.
 * - `chainId`: The associated blockchain chain ID, required and defined by an enumeration.
 * - `minimumStake`: The minimum stake amount required for the application, required and stored as an integer.
 * - `isBootstrapped`: A boolean value indicating if the application is bootstrapped, required.
 * - `rpcUrl`: The RPC URL for application interaction, required.
 * - `indexerApiUrl`: The API URL for indexing services, optional.
 * - `rewardAddresses`: Optional array of reward addresses for the application, stored as a string array. Used by Delegators to fetch provider rewards.
 * - `updatedAtHeight`: Optional field that tracks the blockchain height at the last update, stored as a string.
 * - `createdAt`: Timestamp indicating when the setting was created. Automatically set to the current time by default.
 * - `createdBy`: The identity of the user who created the application setting. It is required and references the `identity` field in the `users` table.
 * - `updatedAt`: Timestamp indicating the last time the setting was updated. It is updated automatically whenever the record changes.
 * - `updatedBy`: The identity of the user who last updated the application setting. It is required and references the `identity` field in the `users` table.
 */
export const applicationSettingsTable = pgTable('application_settings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }),
  appIdentity: varchar({ length: 66 }).notNull(),
  supportEmail: varchar({ length: 255 }),
  ownerIdentity: varchar({ length: 255 }).notNull(),
  ownerEmail: varchar({ length: 255 }),
  chainId: chainIdEnum().notNull(),
  minimumStake: integer().notNull(),
  initialOperationalFunds: integer().default(5),
  minimumOperationalFunds: integer().default(2),
  isBootstrapped: boolean().notNull(),
  rpcUrl: varchar().notNull(),
  indexerApiUrl: varchar(),
  rewardAddresses: varchar().array(),
  updatedAtHeight: varchar(),
  createdAt: timestamp().defaultNow(),
  createdBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  updatedBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
})

/**
 * Represents the structure and type inferred from the `applicationSettingsTable`.
 * The `ApplicationSettings` type is derived automatically using `$inferSelect` to
 * match the shape of the underlying database schema or associated table definition.
 *
 * This type is used to structure application settings data.
 */
export type ApplicationSettings = typeof applicationSettingsTable.$inferSelect;

/**
 * Represents the type definition for inserting application settings into the database.
 *
 * This type corresponds to the inferred shape of the insertable data structure
 * based on the `applicationSettingsTable` schema. It is used to ensure type safety
 * and consistency when inserting new records into the associated database table.
 */
export type InsertApplicationSettings = typeof applicationSettingsTable.$inferInsert;
