import {
  AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
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

/** States of the failure-effects outbox (transactions.failureEffects; CHECKed by migration 0022). */
export type FailureEffectsState = 'pending' | 'releasing' | 'done' | 'manual'

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
  // inclusion in any block > timeoutHeight is impossible (Cosmos ante); null = no embedded height bound (ordered: failure needs sequence evidence; unordered: chain time past timeout_timestamp)
  timeoutHeight: integer(),
  unavailableChecks: integer().notNull().default(0),
  lastVerificationAt: timestamp(),
  // Dispatcher bookkeeping for a pending row that has no hash yet: how many ExecuteTransaction runs
  // it has started for the row (counted only on ticks where the RPC answered, one per run id),
  // since when, and the last run counted. The dispatcher gives up on the row after enough attempts
  // over enough time; see ExecutePendingTransactions.
  dispatchAttempts: integer().notNull().default(0),
  firstDispatchAttemptAt: timestamp({ withTimezone: true }),
  lastDispatchRunId: varchar({ length: 64 }),
  // Failure-effects outbox (migration 0022), written in the SAME update as the CAS that failed the
  // row, so whoever wins the CAS also owes the effects. The give-up and broadcast-rejection CASes
  // write it for every tx type (a row with no release owed, e.g. any non-Stake row, goes straight to
  // done); only the verifier's is Stake-only. NULL = nothing owed (every row before 0022, and every
  // row not failed through a *WithEffects claim). pending -> releasing -> done, or
  // manual when a release POST may have reached the provider and a person must decide; see
  // TransactionFailureEffects. Release addresses: NULL = every staking supplier of the tx; an array
  // = exactly those ([] = release nothing, never coerced to NULL). failureNotifiedAt is the fence
  // that lets the owner be notified at most once.
  failureEffects: varchar().$type<FailureEffectsState>(),
  failureReleaseAddresses: jsonb().$type<string[]>(),
  failureNotifiedAt: timestamp({ withTimezone: true }),

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
  // NOT NULL still admits '': tx 519 (mainnet, 2026-10-22) was stored with an empty signedPayload
  // and could never be broadcast. Added NOT VALID by migration 0020, so pre-existing rows are not
  // rewritten; every insert and update since is checked.
  signedPayloadNotEmpty: check('transactions_signed_payload_not_empty', sql`btrim(${table.signedPayload}) <> ''`),
  unsignedPayloadNotEmpty: check('transactions_unsigned_payload_not_empty', sql`btrim(${table.unsignedPayload}) <> ''`),
  failureEffectsValue: check('transactions_failure_effects_value', sql`${table.failureEffects} IN ('pending', 'releasing', 'done', 'manual')`),
  failureReleaseAddressesArray: check('transactions_failure_release_addresses_array', sql`${table.failureReleaseAddresses} IS NULL OR jsonb_typeof(${table.failureReleaseAddresses}) = 'array'`),
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
