import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm/relations'
import { supplierChangeTypeEnum } from './enums'
import { nodesTable } from './node'

export const supplierChangesTable = pgTable('supplier_changes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  nodeId: integer().notNull().references(() => nodesTable.id),
  changeType: supplierChangeTypeEnum().notNull(),
  serviceId: varchar({ length: 255 }).notNull(),
  description: text().notNull(),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  batchId: varchar({ length: 255 }).notNull(),
  acknowledgedAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
})

export type SupplierChange = typeof supplierChangesTable.$inferSelect
export type InsertSupplierChange = typeof supplierChangesTable.$inferInsert

export const supplierChangesRelations = relations(supplierChangesTable, ({ one }) => ({
  node: one(nodesTable, {
    fields: [supplierChangesTable.nodeId],
    references: [nodesTable.id],
  }),
}))
