import "server-only";
import { getDb } from "@/db";
import { Provider, providersTable } from "@igniter/db/middleman/schema";
import {and, count, eq, sql} from "drizzle-orm";

export async function countProviders(): Promise<number> {
  const [{ value }] = await getDb().select({ value: count() }).from(providersTable)
  return value
}

export async function upsertProviders(
  providers: Pick<Provider, "name" | "identity" | "url" | "enabled" | "visible" | "createdBy" | "updatedBy">[],
) {
  return getDb()
    .insert(providersTable)
    .values(providers)
    .onConflictDoUpdate({
      target: providersTable.identity,
      set: {
        enabled: sql`excluded.enabled`,
      },
    })
    .returning();
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
