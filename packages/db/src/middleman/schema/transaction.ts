import {
  AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import {
  providerFeeEnum,
  transactionStatusEnum,
  transactionTypeEnum,
} from './enums'
import { providersTable } from './provider'
import { usersTable } from './users'
import { transactionsToNodesTable } from './node'


export const transactionsTable = pgTable("transactions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  hash: varchar({ length: 255 }),
  type: transactionTypeEnum().notNull(),
  status: transactionStatusEnum().notNull(),
  code: integer(),
  log: text(),
  executionHeight: integer(),
  executionTimestamp: timestamp(),
  verificationHeight: integer(),
  verificationTimestamp: timestamp(),
  lastCoveredHeight: integer(),
  // inclusion in any block > timeoutHeight is impossible (Cosmos ante); null = no embedded bound (failure needs sequence evidence)
  timeoutHeight: integer(),
  unavailableChecks: integer().notNull().default(0),
  lastVerificationAt: timestamp(),

  //Self-referencing foreign key workaround: https://orm.drizzle.team/docs/indexes-constraints#foreign-key
  dependsOn: integer().references((): AnyPgColumn => transactionsTable.id),

  signedPayload: varchar().notNull(),
  fromAddress: varchar({ length: 255 }).notNull(),
  unsignedPayload: varchar().notNull(),
  estimatedFee: integer().notNull(),
  consumedFee: integer().notNull(),
  // The uPOKT this transaction was created to move, for types whose payload
  // does not carry it. MsgUnstakeSupplier has no amount, so an unstake records
  // the suppliers' total stake at creation. Written once (at creation, or by
  // the worker's recovery path) and never adjusted afterwards: an unstake that
  // fails on-chain keeps the stake it intended to release, the same way a
  // failed Stake row keeps its payload amount. Null means unknown, and readers
  // render it as such rather than as 0. varchar (not integer) because uPOKT
  // overflows int4 past ~2,147 POKT; matches nodes.stakeAmount.
  amount: varchar(),
  providerFee: integer(),
  typeProviderFee: providerFeeEnum(),
  providerId: varchar().references(() => providersTable.identity),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  createdBy: varchar().references(() => usersTable.identity).notNull(),
}, (table) => ({
  verifierSweepIdx: index('mw_transactions_verifier_sweep_idx').on(table.status, table.lastVerificationAt).where(sql`"hash" IS NOT NULL`),
}));

export const transactionsRelations = relations(
  transactionsTable,
  ({ one, many }) => ({
    dependsOn: one(transactionsTable, {
      fields: [transactionsTable.dependsOn],
      references: [transactionsTable.id],
    }),
    createdBy: one(usersTable, {
      fields: [transactionsTable.createdBy],
      references: [usersTable.identity],
    }),
    provider: one(providersTable, {
      fields: [transactionsTable.providerId],
      references: [providersTable.identity],
    }),
    transactionsToNodes: many(transactionsToNodesTable),
  })
);

export type Transaction = typeof transactionsTable.$inferSelect;
export type InsertTransaction = typeof transactionsTable.$inferInsert;
