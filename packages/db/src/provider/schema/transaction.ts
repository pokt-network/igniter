import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
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
  lastCoveredHeight: integer('last_covered_height'),
  // inclusion in any block > timeoutHeight is impossible (Cosmos ante); null = no embedded bound (failure needs sequence evidence)
  timeoutHeight: integer('timeout_height'),
  unavailableChecks: integer('unavailable_checks').notNull().default(0),
  lastVerificationAt: timestamp('last_verification_at'),
  createdAt: timestamp('created_at').defaultNow(),
  // Canonical-lifecycle columns (sign happens in the ExecuteTransaction child):
  signedPayload: text('signed_payload'),        // base64 TxRaw bytes; reused on re-broadcast (idempotency)
  timeoutTimestamp: timestamp('timeout_timestamp', { withTimezone: true }), // unordered failure bound (chain-time)
  params: text('params'),                        // JSON of frozen sign inputs (services/owner/operator/addressGroup) captured at INTENT creation
  reasons: text('reasons'),                      // JSON string[] of all remediation reasons collapsed into this tx
}, (table) => ({
  verifierSweepIdx: index('transactions_verifier_sweep_idx').on(table.status, table.lastVerificationAt).where(sql`"hash" IS NOT NULL`),
  pendingPerKeyUq: uniqueIndex('transactions_key_pending_uq').on(table.keyId).where(sql`status = 'pending'`),
}))

export const transactionsRelations = relations(transactionsTable, ({ one }) => ({
  key: one(keysTable, {
    fields: [transactionsTable.keyId],
    references: [keysTable.id],
  }),
}))

export type Transaction = typeof transactionsTable.$inferSelect
export type InsertTransaction = typeof transactionsTable.$inferInsert
