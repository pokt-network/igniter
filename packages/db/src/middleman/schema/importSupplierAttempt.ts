import {
  integer,
  json,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { importAttemptStatusEnum, ImportAttemptStatus } from './enums'
import { usersTable } from './users'
import { providersTable } from './provider'

/**
 * Represents the schema for the "import_supplier_attempts" table in the database.
 *
 * This table is for audit and recovery purposes - tracks what the middleman knows
 * about import attempts. It helps recover from network failures during the import
 * process.
 *
 * Table Fields:
 * - id: A unique identifier for the attempt. Auto-generated as an identity column.
 * - userIdentity: Reference to the user initiating the import.
 * - ownerAddress: The owner address whose suppliers are being imported.
 * - providerIdentity: The identity of the provider being imported from.
 * - providerId: Reference to the provider in the providers table.
 * - nonce: The challenge nonce received from the provider.
 * - status: The current status of the import attempt.
 * - importedSupplierAddresses: JSON array of successfully imported supplier addresses.
 * - errorMessage: Error message if the attempt failed.
 * - createdAt: The timestamp when the attempt was created.
 * - signedAt: The timestamp when the user signed the nonce.
 * - submittedAt: The timestamp when the import was submitted to the provider.
 * - completedAt: The timestamp when the attempt was completed.
 */
export const importSupplierAttemptsTable = pgTable('import_supplier_attempts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userIdentity: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  ownerAddress: varchar({ length: 255 }).notNull(),
  providerIdentity: varchar({ length: 255 }).notNull(),
  providerId: integer().references(() => providersTable.id),
  nonce: varchar({ length: 255 }),
  status: importAttemptStatusEnum().notNull().default(ImportAttemptStatus.Initiated),
  importedSupplierAddresses: json().$type<string[]>().default([]),
  errorMessage: varchar({ length: 1024 }),
  createdAt: timestamp().defaultNow(),
  signedAt: timestamp(),
  submittedAt: timestamp(),
  completedAt: timestamp(),
})

/**
 * Represents the type inferred from the result of selecting data from the importSupplierAttemptsTable.
 */
export type ImportSupplierAttempt = typeof importSupplierAttemptsTable.$inferSelect

/**
 * Represents the type for handling insert operations for import supplier attempts.
 */
export type InsertImportSupplierAttempt = typeof importSupplierAttemptsTable.$inferInsert
