import "server-only";
import { getDb } from "@/db";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { supplierDeliveriesTable } from "@igniter/db/middleman/schema";

/** How long a browser may release the suppliers of a delivery (the provider expires them later). */
export const DELIVERY_RELEASE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Records the suppliers a provider delivered to this user's stake request. */
export async function recordDelivery(delivery: {
  userIdentity: string;
  providerIdentity: string;
  ownerAddress: string;
  addresses: string[];
}, now: Date = new Date()) {
  if (delivery.addresses.length === 0) return;
  await getDb().insert(supplierDeliveriesTable).values({
    ...delivery,
    expiresAt: new Date(now.getTime() + DELIVERY_RELEASE_WINDOW_MS),
  });
}

export type ReleaseClaim =
  | { kind: 'ok'; deliveryIds: number[]; ownerAddress: string; addresses: string[] }
  | { kind: 'none' }
  | { kind: 'mixed-owners' };

/**
 * Which of the requested addresses this user may release: those inside one of their own
 * unexpired, unreleased deliveries from this provider. Every released address must share one
 * owner, which comes from the record, never from the request.
 */
export async function claimRelease(
  userIdentity: string,
  providerIdentity: string,
  requested: string[],
  now: Date = new Date(),
): Promise<ReleaseClaim> {
  const deliveries = await getDb()
    .select()
    .from(supplierDeliveriesTable)
    .where(and(
      eq(supplierDeliveriesTable.userIdentity, userIdentity),
      eq(supplierDeliveriesTable.providerIdentity, providerIdentity),
      isNull(supplierDeliveriesTable.releasedAt),
      gt(supplierDeliveriesTable.expiresAt, now),
    ));

  const wanted = new Set(requested);
  const addresses = new Set<string>();
  const deliveryIds: number[] = [];
  const owners = new Set<string>();
  for (const delivery of deliveries) {
    const mine = delivery.addresses.filter((address) => wanted.has(address));
    if (mine.length === 0) continue;
    mine.forEach((address) => addresses.add(address));
    deliveryIds.push(delivery.id);
    owners.add(delivery.ownerAddress);
  }

  if (addresses.size === 0) return { kind: 'none' };
  if (owners.size > 1) return { kind: 'mixed-owners' };
  return { kind: 'ok', deliveryIds, ownerAddress: [...owners][0]!, addresses: [...addresses] };
}

export async function markDeliveriesReleased(ids: number[], now: Date = new Date()) {
  if (ids.length === 0) return;
  await getDb()
    .update(supplierDeliveriesTable)
    .set({ releasedAt: now })
    .where(inArray(supplierDeliveriesTable.id, ids));
}
