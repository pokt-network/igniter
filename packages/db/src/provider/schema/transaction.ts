import {
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import {
  transactionStatusEnum,
  transactionTypeEnum,
  transactionTriggerEnum,
} from './enums'
import { keysTable } from './keys'

export const transactionsTable = pgTable('transactions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  keyId: integer('key_id').references(() => keysTable.id),
  keyAddress: varchar('key_address', { length: 255 }).notNull(),
  type: transactionTypeEnum().notNull(),
  status: transactionStatusEnum().notNull(),
  reason: varchar('reason', { length: 10 }),
  trigger: transactionTriggerEnum(),
  hash: varchar('hash', { length: 64 }),
  code: integer(),
  message: text(),
  executionHeight: integer('execution_height'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const transactionsRelations = relations(transactionsTable, ({ one }) => ({
  key: one(keysTable, {
    fields: [transactionsTable.keyId],
    references: [keysTable.id],
  }),
}))

export type Transaction = typeof transactionsTable.$inferSelect
export type InsertTransaction = typeof transactionsTable.$inferInsert
