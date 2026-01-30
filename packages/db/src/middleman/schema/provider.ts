import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import {
  providerFeeEnum,
  ProviderStatus,
  providerStatusEnum,
} from './enums'
import { usersTable } from './users'
import { nodesTable } from './node'
import { transactionsTable } from './transaction'

type AddressGroupsJson = Array<{
  id: number;
  name: string;
  linkedAddresses: string[];
  private: boolean;
  relayMinerId: number;
  keysCount: number;
  relayMiner: {
    id: number;
    name: string;
    identity: string;
    regionId: number;
    domain: string;
    region: {
      id: number;
      displayName: string;
      urlValue: string;
    };
  };
  addressGroupServices: Array<{
    addressGroupId: number;
    serviceId: string;
    addSupplierShare: boolean;
    supplierShare: number;
    revShare: Array<{
      address: string;
      share: number;
    }>;
    service: {
      name: string;
    };
  }>;
}>;

export const providersTable = pgTable('providers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  identity: varchar({ length: 255 }).notNull().unique(),
  url: varchar({ length: 255 }).notNull(),
  enabled: boolean().notNull(),
  visible: boolean().notNull().default(true),
  fee: integer(),
  feeType: providerFeeEnum(),
  domains: text().array().default([]),
  regions: text().array().default([]),
  allowPublicStaking: boolean().default(false),
  allowedStakers: varchar().array().default([]),
  status: providerStatusEnum().notNull().default(ProviderStatus.Unknown),
  minimumStake: integer().notNull().default(0),
  operationalFunds: integer().notNull().default(5),
  addressGroups: jsonb('address_groups').$type<AddressGroupsJson>().default([]),
  rewardAddresses: varchar().array(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  createdBy: varchar().references(() => usersTable.identity).notNull(),
  updatedBy: varchar().references(() => usersTable.identity).notNull(),
})

export const providersRelations = relations(providersTable, ({ many }) => ({
  nodes: many(nodesTable),
  transactions: many(transactionsTable),
}))

export type Provider = typeof providersTable.$inferSelect;
export type InsertProvider = typeof providersTable.$inferSelect;
