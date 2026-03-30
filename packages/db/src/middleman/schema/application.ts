import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { usersTable } from './users'
import { chainIdEnum } from './enums'


export const applicationSettingsTable = pgTable('application_settings', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }),
  appIdentity: varchar().notNull(),
  supportEmail: varchar({ length: 255 }),
  ownerEmail: varchar({ length: 255 }),
  ownerIdentity: varchar({ length: 255 }).notNull(),
  fee: integer(),
  minimumStake: integer().notNull(),
  isBootstrapped: boolean().notNull(),
  chainId: chainIdEnum().notNull(),
  delegatorRewardsAddress: varchar({ length: 255 }),
  pocketApiUrl: varchar().notNull(),
  pocketRpcUrl: varchar(),
  indexerApiUrl: varchar(),
  updatedAtHeight: varchar(),
  privacyPolicy: text(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  createdBy: varchar().references(() => usersTable.identity).notNull(),
  updatedBy: varchar().references(() => usersTable.identity).notNull(),
})

export type ApplicationSettings = typeof applicationSettingsTable.$inferSelect;
export type InsertApplicationSettings = typeof applicationSettingsTable.$inferInsert;
