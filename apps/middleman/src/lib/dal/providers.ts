import "server-only";
import { getDb } from "@/db";
import { Provider, providersTable } from "@igniter/db/middleman/schema";
import {and, count, eq, inArray, sql} from "drizzle-orm";

export type ProviderToInsert = { name: string; identity: string; url: string }
export type ProviderToUpdate = { id: number; name: string; identity: string; url: string }

export async function listAll(): Promise<Provider[]> {
  return getDb().select().from(providersTable)
}

// Same rule as the workflow's governance sync: updates change only identity, name and url (the
// owner's enabled/visible choice is kept), and rows that left the source are disabled and hidden.
export async function applyGovernanceSync(
  toInsert: ProviderToInsert[],
  toUpdate: ProviderToUpdate[],
  toDisable: string[],
  updatedBy: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    for (const p of toInsert) {
      await tx.insert(providersTable).values({
        name: p.name,
        identity: p.identity,
        url: p.url,
        enabled: true,
        visible: true,
        createdBy: updatedBy,
        updatedBy,
      })
    }

    for (const p of toUpdate) {
      await tx
        .update(providersTable)
        .set({ identity: p.identity, name: p.name, url: p.url, updatedBy })
        .where(eq(providersTable.id, p.id))
    }

    if (toDisable.length > 0) {
      await tx
        .update(providersTable)
        .set({ enabled: false, visible: false, updatedAt: new Date(), updatedBy })
        .where(inArray(providersTable.identity, toDisable))
    }
  })
}

export async function countProviders(): Promise<number> {
  const [{ value }] = await getDb().select({ value: count() }).from(providersTable)
  return value
}

export async function list(all?: boolean) : Promise<Provider[]> {
  const filters = [];

  if (!all) {
    filters.push(eq(providersTable.visible, true));
  }

  const providers = await getDb().query.providersTable.findMany({
    ...(filters.length > 0 && { where: and(...filters) }),
  });

  if (!providers) {
    return [];
  }

  return providers;
}

export async function getByIdentity(identity: string) {
  return getDb().query.providersTable.findFirst({
    where: (providers, {eq, and}) => {
      return and(
        eq(providers.identity, identity),
        eq(providers.enabled, true),
        eq(providers.visible, true)
      );
    },
  });
}

export async function update(
  identity: string,
  providerUpdates: Partial<Provider>,
): Promise<Provider> {
  const [updatedProvider] = await getDb()
    .update(providersTable)
    .set(providerUpdates)
    .where(sql`${providersTable.identity} = ${identity}`)
    .returning();

  if (!updatedProvider) {
    throw new Error("Failed to update the provider");
  }

  return updatedProvider;
}
