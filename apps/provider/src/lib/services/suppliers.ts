import {SupplierStakeRequest} from "@/lib/models/supplier";
import {Supplier} from "@igniter/domain/provider/models";
import {list} from "@/lib/dal/addressGroups";
import {list as listServices} from '@/lib/dal/services'
import {createKeys} from "@/lib/services/keys";
import {
  insertNewKeys,
  lockAvailableKeys,
  markAvailable,
  markKeysDelivered,
  markStaked,
  markUnstaking,
} from '@/lib/dal/keys'
import {getDb} from "@/db";
import {BuildSupplierServiceConfigHandler} from "@igniter/domain/provider/operations";
import {InsertKey, Key} from "@igniter/db/provider/schema";

type KeyDistributionItem = { numberOfKeys: number[] };

/**
 * Distributes a specified number of new items across groups with existing workloads.
 * Each new item is assigned to the group with the lowest current total workload.
 *
 * @param newItems A list of stake amounts, its length represents the total number of new keys to be created
 * @param groups Array of groups, each with an existing workload count
 * @returns Array of new item counts per group after distribution
 */
function calculateDistribution(
  newItems: number[],
  groups: { keysCount: number }[]
): KeyDistributionItem[] {
  const totalNewItems = newItems.length;
  const groupCount = groups.length;
  const newItemsPerGroup: KeyDistributionItem[] = Array.from(
    {length: groupCount},
    () => ({numberOfKeys: []})
  );


  if (groupCount === 0) {
    return newItemsPerGroup;
  }

  if (groupCount === 1) {
    newItemsPerGroup[0] = {numberOfKeys: newItems};
    return newItemsPerGroup;
  }

  if (!groups[0]) {
    return newItemsPerGroup;
  }

  for (let itemIndex = 0; itemIndex < totalNewItems; itemIndex++) {
    let lowestLoadGroupIndex = 0;
    let lowestTotalLoad = groups[0].keysCount + (newItemsPerGroup[0]?.numberOfKeys.length || 0);

    for (let groupIndex = 1; groupIndex < groupCount; groupIndex++) {
      const currentGroup = groups[groupIndex];
      if (!currentGroup) continue;

      const currentTotalLoad = currentGroup.keysCount + (newItemsPerGroup[groupIndex]?.numberOfKeys.length || 0);

      if (currentTotalLoad < lowestTotalLoad) {
        lowestTotalLoad = currentTotalLoad;
        lowestLoadGroupIndex = groupIndex;
      }
    }

    newItemsPerGroup[lowestLoadGroupIndex]?.numberOfKeys.push(newItems[itemIndex]!);
  }

  return newItemsPerGroup;
}

export async function getSupplierStakeConfigurations(
    stakeDistribution: SupplierStakeRequest,
    requestingDelegator: string,
    simulate: boolean = false,
): Promise<Supplier[]> {
    const allGroups = await list(undefined, stakeDistribution.region);
    const linked = allGroups.filter(g =>
        g.linkedAddresses?.includes(stakeDistribution.ownerAddress)
    );
    const addressGroups = linked.length
        ? linked
        : allGroups.filter(g => !g.private);

    const services = await listServices();

    const totalAmounts = stakeDistribution.items.flatMap(i =>
        Array(i.qty).fill(i.amount)
    );
    const perGroup = calculateDistribution(totalAmounts, addressGroups);
    const slotsByGroup = addressGroups.map((grp, i) => ({
        addressGroup: grp,
        slots: perGroup[i]!.numberOfKeys,
    }));

    let allocation: {
        addressGroup: typeof addressGroups[0];
        slots: number[];
        keys: { address: string }[];
    }[];

    try {
        allocation = await getDb().transaction(async (tx) => {
            const results  = [];

            for (const { addressGroup, slots } of slotsByGroup) {
                const needed = slots.length;

                const avail = simulate ? [] : await lockAvailableKeys(tx as any, addressGroup.id, needed);

                const reused = simulate ? [] : await markKeysDelivered(
                    tx as any,
                    avail.map(k => k.id),
                    requestingDelegator,
                    stakeDistribution.ownerAddress,
                    stakeDistribution.revSharePercentage ?? 0,
                    stakeDistribution.delegatorAddress
                );

                const toCreate = needed - reused.length;
                let created: InsertKey[] = [];
                if (toCreate > 0) {
                    const newRows = await createKeys({
                        addressGroupId: addressGroup.id,
                        willDeliverTo: requestingDelegator,
                        numberOfKeys: toCreate,
                        ownerAddress: stakeDistribution.ownerAddress,
                        delegatorRevSharePercentage: stakeDistribution.revSharePercentage ?? 0,
                        delegatorRewardsAddress: stakeDistribution.delegatorAddress,
                    });
                    created = simulate
                      ? newRows
                      : await insertNewKeys(tx as any, newRows);
                }

                results.push({
                    addressGroup,
                    slots,
                    keys: [...reused, ...created],
                });
            }

            return results;
        });
    } catch (error) {
        const {message} = error as Error;
        throw new Error(`Failed to allocate keys: ${message}`);
    }

    const suppliers: Supplier[] = [];

    const buildSupplierServiceConfigs = new BuildSupplierServiceConfigHandler();


    for (const { addressGroup, slots, keys } of allocation) {
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]!;
            const stakeAmount = slots[i]!.toString();

            const supplierServices = buildSupplierServiceConfigs.execute({
                services,
                addressGroup,
                operatorAddress: key.address,
                ownerAddress: stakeDistribution.ownerAddress,
                requestRevShare: [
                    {
                        revSharePercentage: stakeDistribution.revSharePercentage,
                        address: stakeDistribution.delegatorAddress,
                    }
                ]
            });

            suppliers.push({
                operatorAddress: key.address,
                stakeAmount,
                services: supplierServices,
            });
        }
    }

    return suppliers;
}

export async function releaseDeliveredSuppliers(addresses: string[], requestingDelegator: string) {
  return markAvailable(addresses, requestingDelegator);
}

export async function markDeliveredSupplierAsStaked(addresses: string[], requestingDelegator: string) {
    return markStaked(addresses, requestingDelegator);
}

export async function markStakedSupplierAsUnstaking(addresses: string[], requestingDelegator: string) {
    return markUnstaking(addresses, requestingDelegator);
}
