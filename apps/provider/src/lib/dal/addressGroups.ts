import type {
  AddressGroup,
  AddressGroupService,
  AddressGroupWithDetails,
  InsertAddressGroup,
} from '@igniter/db/provider/schema'

import {
  and,
  eq,
  sql,
} from 'drizzle-orm'
import { getDbClient } from '@/db'
import * as schema from '@igniter/db/provider/schema'
import {
  addressGroupServicesTable,
  addressGroupTable,
  keysTable,
  relayMinersTable,
} from '@igniter/db/provider/schema'
import {DBClient} from "@igniter/db/connection";

export async function insert(
  addressGroup: InsertAddressGroup,
  services: Omit<AddressGroupService, 'addressGroupId' | 'service'>[],
): Promise<AddressGroup> {
  const dbClient: DBClient<typeof schema> = getDbClient()
  return dbClient.db.transaction(async (tx) => {
    const [insertedGroup] = await tx
      .insert(addressGroupTable)
      .values(addressGroup)
      .returning()

    if (!insertedGroup) {
      throw new Error('Failed to insert address group')
    }

    if (services.length > 0) {
      const toInsert = services.map((s) => ({
        addressGroupId: insertedGroup.id,
        serviceId: s.serviceId,
        addSupplierShare: s.addSupplierShare ?? false,
        supplierShare: s.supplierShare ?? null,
        revShare: s.revShare ?? [],
        endpointOverrides: s.endpointOverrides ?? {},
      }))

      await tx.insert(addressGroupServicesTable).values(toInsert)
    }

    return insertedGroup
  })
}

export async function update(
  id: number,
  addressGroupUpdates: Partial<AddressGroup>,
  services: Omit<AddressGroupService, 'addressGroupId' | 'service'>[],
): Promise<AddressGroup> {
  const dbClient = getDbClient()
  return dbClient.db.transaction(async (tx) => {
    const [updatedGroup] = await tx
      .update(addressGroupTable)
      .set(addressGroupUpdates)
      .where(sql`${addressGroupTable.id} = ${id}`)
      .returning()

    if (!updatedGroup) {
      throw new Error('Failed to update the address group')
    }

    await tx
      .delete(addressGroupServicesTable)
      .where(sql`${addressGroupServicesTable.addressGroupId} = ${id}`)

    if (services.length > 0) {
      const toInsert = services.map((s) => ({
        addressGroupId: id,
        serviceId: s.serviceId,
        addSupplierShare: s.addSupplierShare ?? false,
        supplierShare: s.supplierShare ?? null,
        revShare: s.revShare ?? [],
        endpointOverrides: s.endpointOverrides ?? {},
      }))
      await tx.insert(addressGroupServicesTable).values(toInsert)
    }

    return updatedGroup
  })
}

export async function remove(id: number): Promise<AddressGroup> {
  const dbClient = getDbClient()
  return dbClient.db.transaction(async (tx) => {
    await tx
      .delete(addressGroupServicesTable)
      .where(sql`${addressGroupServicesTable.addressGroupId} = ${id}`)

    const [deletedGroup] = await tx
      .delete(addressGroupTable)
      .where(sql`${addressGroupTable.id} = ${id}`)
      .returning()

    if (!deletedGroup) {
      throw new Error('Failed to delete address group')
    }

    return deletedGroup
  })
}

export async function list(
  priv?: boolean,
  region?: number,
): Promise<AddressGroupWithDetails[]> {
  const filters = []

  if (region) {
    filters.push(eq(relayMinersTable.regionId, region))
  }
  if (priv !== undefined) {
    filters.push(eq(addressGroupTable.private, priv))
  }
  const dbClient = getDbClient()
  return dbClient.db.query.addressGroupTable.findMany({
    ...(filters.length > 0 && { where: and(...filters) }),
    columns: {
      id: true,
      name: true,
      linkedAddresses: true,
      private: true,
      relayMinerId: true,
      createdAt: true,
      updatedAt: true,
      createdBy: true,
      updatedBy: true,
    },
    with: {
      relayMiner: {
        columns: {
          id: true,
          name: true,
          identity: true,
          regionId: true,
          domain: true,
          createdAt: true,
          updatedAt: true,
          createdBy: true,
          updatedBy: true,
        },
        with: {
          region: true,
        },
      },
      addressGroupServices: {
        with: {
          service: {
            columns: {
              name: true,
              endpoints: true,
            },
          },
        },
      },
    },
    extras: {
      keysCount: sql<number>`
        CAST(
          (
            SELECT COUNT(*)
            FROM ${keysTable}
        WHERE ${keysTable}."address_group_id" = ${addressGroupTable.id}
        ) AS INTEGER
        )
      `.as('keys_count'),
    },
    orderBy: addressGroupTable.name,
  })
}


export async function simpleList() {
  const dbClient = getDbClient()
  return dbClient.db.query.addressGroupTable.findMany()
}

export async function findById(id: number): Promise<AddressGroup | undefined> {
  const dbClient = getDbClient()
  return dbClient.db.query.addressGroupTable.findFirst({
    where: eq(addressGroupTable.id, id),
  })
}
