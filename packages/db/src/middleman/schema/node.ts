import {
  bigint,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm/relations'
import { nodeStatusEnum } from './enums'
import {
  Provider,
  providersTable,
} from './provider'
import { usersTable } from './users'
import {
  Transaction,
  transactionsTable,
} from './transaction'


export type NodeService = {
  serviceId: string;
  endpoints: Array<{ url: string; rpcType: number }>;
  revShare: Array<{ address: string; revSharePercentage: number }>;
  /** Set when the service comes from serviceConfigHistory and is not yet active on-chain */
  pendingActivationHeight?: number;
};

export const nodesTable = pgTable('nodes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  address: varchar({ length: 255 }).notNull(),
  ownerAddress: varchar({ length: 255 }).notNull(),
  status: nodeStatusEnum().notNull(),
  stakeAmount: varchar().notNull(),
  balance: bigint({ mode: 'bigint' }).notNull(),
  providerId: varchar().references(() => providersTable.identity),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow(),
  createdBy: varchar().references(() => usersTable.identity).notNull(),
  // metadata coming from the blockchain
  lastUpdatedHeight: integer().default(0), // prevent updating this record with values of a lower height
  services: jsonb('services').$type<NodeService[]>().default([]),
})

export type Node = typeof nodesTable.$inferSelect;

export type NodeWithDetails = Node & {
  provider: Provider | null;
  transactionsToNodes: TransactionsToNodes[];
};

export type InsertNode = typeof nodesTable.$inferInsert;

export const nodesRelations = relations(nodesTable, ({ one, many }) => ({
  provider: one(providersTable, {
    fields: [nodesTable.providerId],
    references: [providersTable.identity],
  }),
  createdBy: one(usersTable, {
    fields: [nodesTable.createdBy],
    references: [usersTable.identity],
  }),
  transactionsToNodes: many(transactionsToNodesTable),
}))

export const transactionsToNodesTable = pgTable('transactions_to_nodes', {
    transactionId: integer().notNull().references(() => transactionsTable.id),
    nodeId: integer().notNull().references(() => nodesTable.id),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.nodeId] }),
  ],
)

export type InsertTransactionsToNodesRelation = typeof transactionsToNodesTable.$inferInsert;

export type TransactionsToNodes = typeof transactionsToNodesTable.$inferSelect;

export type TransactionsToNodesWithDetails = TransactionsToNodes & {
  transaction: Transaction;
  node: Node;
};

export const transactionsToNodesRelations = relations(transactionsToNodesTable, ({ one }) => ({
  transaction: one(transactionsTable, {
    fields: [transactionsToNodesTable.transactionId],
    references: [transactionsTable.id],
  }),
  node: one(nodesTable, {
    fields: [transactionsToNodesTable.nodeId],
    references: [nodesTable.id],
  }),
}))
