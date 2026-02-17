import {
  integer,
  json,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { importRequestStatusEnum, ImportRequestStatus } from './enums'
import { delegatorsTable } from './delegator'

/**
 * Represents the schema for the "import_supplier_requests" table in the database.
 *
 * This table stores import requests from delegators to import suppliers from a provider.
 * The flow verifies ownership through wallet signature before the provider assigns their
 * staked keys to the delegator.
 *
 * Table Fields:
 * - id: A unique identifier for the request. Auto-generated as an identity column.
 * - ownerAddress: The address of the owner whose suppliers are being imported.
 * - delegatorIdentity: Reference to the delegator initiating the import.
 * - nonce: A unique challenge nonce for signature verification.
 * - status: The current status of the import request.
 * - matchingSupplierAddresses: JSON array of supplier addresses that match the owner.
 * - delegatorRevSharePercentage: The revenue share percentage for the delegator.
 * - delegatorRewardsAddress: The address where delegator rewards will be sent.
 * - errorMessage: Error message if the request failed.
 * - createdAt: The timestamp when the record was created.
 * - completedAt: The timestamp when the request was completed.
 * - expiresAt: The timestamp when the request expires (15 minutes from creation).
 */
export const importSupplierRequestsTable = pgTable('import_supplier_requests', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ownerAddress: varchar({ length: 255 }).notNull(),
  delegatorIdentity: varchar({ length: 66 }).references(() => delegatorsTable.identity),
  nonce: varchar({ length: 255 }).notNull().unique(),
  status: importRequestStatusEnum().notNull().default(ImportRequestStatus.Pending),
  matchingSupplierAddresses: json().$type<string[]>().default([]),
  delegatorRevSharePercentage: integer(),
  delegatorRewardsAddress: varchar({ length: 255 }),
  errorMessage: varchar({ length: 1024 }),
  createdAt: timestamp().defaultNow(),
  completedAt: timestamp(),
  expiresAt: timestamp().notNull(),
})

/**
 * Represents the type inferred from the result of selecting data from the importSupplierRequestsTable.
 */
export type ImportSupplierRequest = typeof importSupplierRequestsTable.$inferSelect

/**
 * Represents the type for handling insert operations for import supplier requests.
 */
export type InsertImportSupplierRequest = typeof importSupplierRequestsTable.$inferInsert
