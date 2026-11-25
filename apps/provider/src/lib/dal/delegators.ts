import { getDbClient } from "@/db";
import type {Delegator} from "@igniter/db/provider/schema";
import {delegatorsTable} from "@igniter/db/provider/schema";
import {count, eq, sql} from "drizzle-orm";
import {getLogger} from "@igniter/logger";
import {z} from "zod";

const log = getLogger(["provider", "delegators"]);

import { identitySchema, nameSchema } from "@/lib/delegatorsCdn";
export { cdnDelegatorsSchema, parseCdnDelegators, type CdnDelegator } from "@/lib/delegatorsCdn";

const governanceSyncSchema = z.object({
  toInsert: z.array(z.object({ name: nameSchema, identity: identitySchema })),
  toUpdate: z.array(z.object({ id: z.number().int().positive(), name: nameSchema, identity: identitySchema })),
  toDisable: z.array(z.object({ identity: identitySchema })),
})

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

/**
 * Writes a governance sync computed by the caller:
 * - the three lists are validated first; an invalid one throws before any write;
 * - new delegators are inserted DISABLED, until the owner enables them in the UI;
 * - the identity of an ENABLED row is never rotated: each update re-reads its row inside the
 *   transaction, and when that row is enabled only the name is written and a warning is logged
 *   (the owner disables the row, the next sync rotates it, the owner re-enables it).
 */
export async function applyGovernanceSync(
  toInsert: DelegatorToInsert[],
  toUpdate: DelegatorToUpdate[],
  toDisable: DelegatorToDisable[],
  updatedBy: string,
  // Setup (an owner action) enables what it inserts; the periodic sync leaves new rows disabled.
  options: { enableNew?: boolean } = {},
): Promise<void> {
  const sync = governanceSyncSchema.parse({ toInsert, toUpdate, toDisable })
  const dbClient = getDbClient()
  await dbClient.db.transaction(async (tx) => {
    for (const d of sync.toInsert) {
      await tx.insert(delegatorsTable).values({
        name: d.name,
        identity: d.identity,
        createdBy: updatedBy,
        updatedBy,
        // Disabled until the owner approves it in the UI, unless the owner is running the setup.
        enabled: options.enableNew === true,
      })
    }

    for (const d of sync.toUpdate) {
      const [row] = await tx
        .select()
        .from(delegatorsTable)
        .where(eq(delegatorsTable.id, d.id))
      if (!row) continue

      const identityChanged = row.identity !== d.identity
      if (identityChanged && row.enabled) {
        log.warn("Governance lists a new identity for an enabled delegator; not rotating it", {
          delegatorId: row.id,
          name: row.name,
          currentIdentity: row.identity,
          governanceIdentity: d.identity,
        })
        if (row.name === d.name) continue
      }

      await tx
        .update(delegatorsTable)
        .set({
          ...(identityChanged && !row.enabled ? { identity: d.identity } : {}),
          name: d.name,
          updatedBy,
        })
        .where(eq(delegatorsTable.id, d.id))
    }

    for (const d of sync.toDisable) {
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
