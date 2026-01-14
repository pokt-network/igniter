import {
  boolean,
  integer,
  json,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import {
  relayMinersTable,
  RelayMinerWithDetails,
} from './relayminer'
import { usersTable } from './user'
import { keysTable } from './keys'
import { servicesTable } from './service'
import { RPCType } from '@igniter/pocket'

/**
 * Represents the `address_groups` table in the database.
 *
 * This table stores information related to address groups, including metadata,
 * associations with users and relay miners, and tracking details such as created and
 * updated timestamps.
 *
 * Fields:
 * - `id`: A unique identifier for each address group. It is a primary key and is auto-generated.
 * - `name`: The name of the address group. This field is required.
 * - `linkedAddresses`: An array of linked address values. Defaults to an empty array.
 * - `private`: A boolean flag indicating whether the address group is private. This field is required and defaults to `false`.
 * - `relayMinerId`: References the primary key of the `relay_miners` table, representing the associated relay miner. This field is required and enforces the `RESTRICT` delete rule.
 * - `createdAt`: A timestamp indicating when the address group was created. Defaults to the current timestamp.
 * - `createdBy`: References the `identity` field in the `users` table, indicating the user who created the address group. This field is required.
 * - `updatedAt`: A timestamp indicating the last time the address group was updated. Automatically updated on modification.
 * - `updatedBy`: References the `identity` field in the `users` table, representing the user who last updated the address group. This field is required.
 */
export const addressGroupTable = pgTable('address_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  linkedAddresses: varchar().array().default([]),
  private: boolean().notNull().default(false),
  relayMinerId: integer('relay_miner_id')
    .references(() => relayMinersTable.id, { onDelete: 'restrict' })
    .notNull(),
  createdAt: timestamp().defaultNow(),
  createdBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  updatedBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
})

/**
 * Represents a group of address data selected from the `addressGroupTable`.
 *
 * This type is derived from the structure of the `addressGroupTable` using `$inferSelect`.
 * It enables strong typing for objects representing rows selected from the table.
 *
 * It is used to define the shape of data related to an address group, ensuring that
 * operations performed on address group data have type safety and align with the
 * structure of the associated database table.
 *
 * The type details of the inferred structure depend on the schema of `addressGroupTable`.
 */
export type AddressGroup = typeof addressGroupTable.$inferSelect;

/**
 * Represents a type that infers the structure of an insertable row for the Address Group table.
 *
 * This type is typically used for inserting new records into the database,
 * ensuring that the format and fields align with the schema definition.
 *
 * It derives from the `$inferInsert` utility, which creates a type based
 * on the table's insert requirements.
 */
export type InsertAddressGroup = typeof addressGroupTable.$inferInsert;

/**
 * Represents a detailed address group which extends the basic AddressGroup with additional properties.
 *
 * This type includes information about the number of keys, associated services, and relay miner details.
 *
 * @typedef {AddressGroupWithDetails}
 * @property {number} keysCount - The total count of keys associated with the address group.
 * @property {AddressGroupService[]} addressGroupServices - A list of services linked to the address group.
 * @property {RelayMinerWithDetails} relayMiner - The relay miner details associated with this address group.
 */
export type AddressGroupWithDetails = AddressGroup & {
  keysCount: number;
  addressGroupServices: AddressGroupService[];
  relayMiner: RelayMinerWithDetails;
}

/**
 * Represents the database table `address_group_services` used to associate address groups with services
 * and store related configuration details.
 *
 * Columns:
 * - `addressGroupId`: The unique identifier of the address group. This is a foreign key referencing the `id`
 *   field of the `addressGroupTable`. It cannot be null.
 * - `serviceId`: The unique identifier of the service. This is a foreign key referencing the `serviceId`
 *   field of the `servicesTable`. It cannot be null.
 * - `addSupplierShare`: A flag indicating whether to add a supplier share for the service. Defaults to `false`.
 * - `supplierShare`: The numeric value representing the supplier's share. Defaults to 0.
 * - `revShare`: A JSON array specifying the revenue share details. Each object in the array contains an
 *   `address` (string) and a `share` (number). Defaults to an empty array. Cannot be null.
 *
 * Constraints:
 * - Primary Key: A composite primary key consisting of `addressGroupId` and `serviceId`.
 */
export const addressGroupServicesTable = pgTable(
  'address_group_services',
  {
    addressGroupId: integer('address_group_id')
      .notNull()
      .references(() => addressGroupTable.id),

    serviceId: varchar('service_id')
      .notNull()
      .references(() => servicesTable.serviceId),

    addSupplierShare: boolean().notNull().default(false),

    supplierShare: integer().default(0),

    revShare: json('revShare')
      .$type<{ address: string; share: number }[]>()
      .notNull()
      .default([]),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.addressGroupId, table.serviceId] }),
  }),
)

/**
 * Represents the AddressGroupService type, which combines properties inferred from the `addressGroupServicesTable` declaration
 * and extends it with a service property that includes additional metadata.
 *
 * This type encapsulates the structure and definition of an address group service entity, ensuring consistency
 * and type safety within the application.
 *
 * Structure:
 * - Inherits attributes dynamically inferred from `addressGroupServicesTable`.
 * - Adds a `service` object containing metadata about the service.
 *
 * Fields:
 * - `service`: An object containing additional metadata such as:
 *    - `name`: A string representing the name of the service.
 */
export type AddressGroupService = typeof addressGroupServicesTable.$inferSelect & {
  service: {
    name: string;
    endpoints: Array<{
      url: string;
      rpcType: RPCType;
    }>
  }
};

/**
 * Represents a service for inserting address group data.
 *
 * This type is inferred from the `addressGroupServicesTable`'s insertable data structure.
 * It should be used when defining or handling data meant for insertion into the address group services.
 *
 * The structure and fields of this type depend on the schema and definition
 * within the `addressGroupServicesTable`.
 */
export type InsertAddressGroupService = typeof addressGroupServicesTable.$inferInsert;

/**
 * Represents the relations between the address group table and other associated tables.
 * Defines how the `addressGroupTable` is related to `keysTable`,
 * `addressGroupServicesTable`, and `relayMinersTable` through their respective fields.
 *
 * Structure:
 * - `addresses`: Establishes a one-to-many relationship with `keysTable`.
 * - `addressGroupServices`: Establishes a one-to-many relationship with `addressGroupServicesTable`.
 * - `relayMiner`: Establishes a one-to-one relationship with `relayMinersTable`.
 *   The relationship is defined by matching the `relayMinerId` field in
 *   `addressGroupTable` with the `id` field in `relayMinersTable`.
 */
export const addressGroupsRelations = relations(
  addressGroupTable,
  ({ many, one }) => ({
    addresses: many(keysTable),
    addressGroupServices: many(addressGroupServicesTable),
    relayMiner: one(relayMinersTable, {
      fields: [addressGroupTable.relayMinerId],
      references: [relayMinersTable.id],
    }),
  }),
)

/**
 * Represents the relations between address groups and services in the database.
 *
 * This variable establishes relationships for the `addressGroupServicesTable`.
 * It connects an address group to a corresponding service by defining one-to-one
 * relationships with the `addressGroupTable` and `servicesTable`.
 *
 * Relationships:
 * - `addressGroup`: Links the `addressGroupServicesTable.addressGroupId` field to the
 *   `addressGroupTable.id` field, creating a reference to an address group.
 * - `service`: Links the `addressGroupServicesTable.serviceId` field to the
 *   `servicesTable.serviceId` field, creating a reference to a service.
 */
export const addressGroupServicesRelations = relations(
  addressGroupServicesTable,
  ({ one }) => ({
    addressGroup: one(addressGroupTable, {
      fields: [addressGroupServicesTable.addressGroupId],
      references: [addressGroupTable.id],
    }),
    service: one(servicesTable, {
      fields: [addressGroupServicesTable.serviceId],
      references: [servicesTable.serviceId],
    }),
  }),
)

