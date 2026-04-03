import { getDbClient } from "@/db";
import type {Delegator} from "@igniter/db/provider/schema";
import {delegatorsTable} from "@igniter/db/provider/schema";
import {count, eq, sql} from "drizzle-orm";

export async function countDelegators(): Promise<number> {
  const dbClient = getDbClient()
  const [{ value }] = await dbClient.db.select({ value: count() }).from(delegatorsTable)
  return value
}

export async function getDelegatorByIdentity(identity: string) {
  const dbClient = getDbClient()
  return dbClient.db.query.delegatorsTable.findFirst({
    where: (delegators, { and, eq }) =>
      and(
        eq(delegators.identity, identity),
        eq(delegators.enabled, true),
      ),
  });
}


export async function disableAll(disabledBy: string) {
  const dbClient = getDbClient()
  return dbClient.db.transaction(async (tx) => {
    const updatedDelegators = await tx
      .update(delegatorsTable)
      .set({
        enabled: false,
        updatedBy: disabledBy,
      })
      .returning();

    if (!updatedDelegators.length) {
      throw new Error("Failed to deselect all or some delegators");
    }

    return updatedDelegators;
  });
}

export async function enableAll(enabledBy: string) {
  const dbClient = getDbClient()
  return dbClient.db.transaction(async (tx) => {
    const updatedDelegators = await tx
      .update(delegatorsTable)
      .set({
        enabled: true,
        updatedBy: enabledBy,
      })
      .returning();

    if (!updatedDelegators.length) {
      throw new Error("Failed to deselect all or some delegators");
    }

    return updatedDelegators;
  })
}

export async function list() {
  const dbClient = getDbClient()
  return dbClient.db.query.delegatorsTable.findMany();
}


export type DelegatorToInsert = { name: string; identity: string }
export type DelegatorToUpdate = { id: number; name: string; identity: string }
export type DelegatorToDisable = { identity: string }

export async function listAll() {
  const dbClient = getDbClient()
  return dbClient.db.select().from(delegatorsTable)
}

export async function applyGovernanceSync(
  toInsert: DelegatorToInsert[],
  toUpdate: DelegatorToUpdate[],
  toDisable: DelegatorToDisable[],
  updatedBy: string,
): Promise<void> {
  const dbClient = getDbClient()
  await dbClient.db.transaction(async (tx) => {
    for (const d of toInsert) {
      await tx.insert(delegatorsTable).values({
        name: d.name,
        identity: d.identity,
        createdBy: updatedBy,
        updatedBy,
        enabled: true,
      })
    }

    for (const d of toUpdate) {
      await tx
        .update(delegatorsTable)
        .set({ identity: d.identity, name: d.name, updatedBy })
        .where(eq(delegatorsTable.id, d.id))
    }

    for (const d of toDisable) {
      await tx
        .update(delegatorsTable)
        .set({ enabled: false, updatedAt: new Date(), updatedBy })
        .where(eq(delegatorsTable.identity, d.identity))
    }
  })
}

export async function update(
  identity: string,
  delegatorUpdates: Partial<Delegator>,
): Promise<Delegator> {
  const dbClient = getDbClient()
  const [updatedDelegator] = await dbClient.db
    .update(delegatorsTable)
    .set(delegatorUpdates)
    .where(sql`${delegatorsTable.identity} = ${identity}`)
    .returning();

  if (!updatedDelegator) {
    throw new Error("Failed to update the delegator");
  }

  return updatedDelegator;
}
