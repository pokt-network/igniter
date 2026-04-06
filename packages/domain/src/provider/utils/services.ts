import type {AddressGroupService} from "@igniter/db/provider/schema";

/**
 * Merges revShare entries that share the same address by summing their percentages.
 * The chain can return (or we can produce) multiple entries for the same address;
 * this normalises them to a single entry per address so comparisons and stakes are correct.
 */
export function deduplicateRevShare<T extends { address: string; revSharePercentage: number }>(
  revShare: T[],
): T[] {
  const map = new Map<string, T>()
  for (const entry of revShare) {
    const key = entry.address.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      map.set(key, { ...existing, revSharePercentage: existing.revSharePercentage + entry.revSharePercentage })
    } else {
      map.set(key, { ...entry, address: entry.address })
    }
  }
  return [...map.values()]
}

export function getRevShare(addressGroupService: AddressGroupService, operatorAddress: string) {
  const revShare = addressGroupService.revShare.map(({address, share}) => ({
    address,
    revSharePercentage: share,
  }));

  if (addressGroupService.addSupplierShare) {
    revShare.push({
      address: operatorAddress,
      revSharePercentage: addressGroupService.supplierShare!,
    });
  }

  return revShare.length > 0 ? revShare : [];
}
