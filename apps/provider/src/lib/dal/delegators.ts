import { getDbClient } from "@/db";
import type {Delegator} from "@igniter/db/provider/schema";
import {delegatorsTable} from "@igniter/db/provider/schema";
import {count, sql} from "drizzle-orm";

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
