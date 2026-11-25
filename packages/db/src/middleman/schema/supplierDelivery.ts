import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { usersTable } from './users'

/**
 * Suppliers a provider delivered to a user's stake request, recorded by the middleman when it
 * proxies `/api/suppliers?simulate=false`. A browser release of Delivered keys is allowed only for
 * addresses of an unexpired, unreleased delivery of the same user, with the owner taken from here.
 *
 * Table Fields:
 * - userIdentity: the session user who requested the suppliers.
 * - providerIdentity: the provider that delivered them.
 * - ownerAddress: the owner they were delivered to.
 * - addresses: the delivered supplier (operator) addresses.
 * - expiresAt: after this the delivery can no longer be released from the browser (24h).
 * - releasedAt: set when the browser released them.
 */
export const supplierDeliveriesTable = pgTable('supplier_deliveries', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userIdentity: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  providerIdentity: varchar({ length: 255 }).notNull(),
  ownerAddress: varchar({ length: 255 }).notNull(),
  addresses: text().array().notNull(),
  expiresAt: timestamp().notNull(),
  releasedAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
}, (table) => [
  index('supplier_deliveries_user_provider_idx').on(table.userIdentity, table.providerIdentity),
])

export type SupplierDelivery = typeof supplierDeliveriesTable.$inferSelect
export type InsertSupplierDelivery = typeof supplierDeliveriesTable.$inferInsert
