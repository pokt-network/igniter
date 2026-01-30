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

export async function getSupplierStakeConfigurations(
    stakeDistribution: SupplierStakeRequest,
    requestingDelegator: string,
    simulate: boolean = false,
): Promise<Supplier[]> {
    const allGroups = await list(undefined, stakeDistribution.region);

    // Find the specific address group by ID
    const selectedAddressGroup = allGroups.find(g => g.id === stakeDistribution.addressGroupId);

    if (!selectedAddressGroup) {
        throw new Error(`Address group with ID ${stakeDistribution.addressGroupId} not found`);
    }

    const services = await listServices();

    const totalAmounts = stakeDistribution.items.flatMap(i =>
        Array(i.qty).fill(i.amount)
    );

    // Assign all keys to the selected address group
    const slotsByGroup = [{
        addressGroup: selectedAddressGroup,
        slots: totalAmounts,
    }];

    let allocation: {
        addressGroup: typeof selectedAddressGroup;
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
