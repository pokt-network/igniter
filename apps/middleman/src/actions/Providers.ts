"use server";

import {countProviders, list, upsertProviders, getByIdentity, update} from "@/lib/dal/providers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {requireAuth} from "@/lib/utils/actions";
import {ProviderStatus} from "@igniter/db/middleman/enums";

export interface Provider {
  id: number;
  name: string;
  identity: string;
  url: string;
}

const updateProvidersSchema = z.object({
  providers: z.array(z.string()).refine((value) => value.some((item) => item), {
    message: "You have to select at least one provider.",
  }),
});

const GOVERNANCE_SYNC_SCHEDULE_ID = 'GovernanceSync-scheduled'

export async function TriggerGovernanceSync(): Promise<{ success: boolean, error?: string }> {
  try {
    await requireAuth()
    const { getTemporalClient } = await import('@/lib/temporal')
    const client = getTemporalClient()
    const handle = client.schedule.getHandle(GOVERNANCE_SYNC_SCHEDULE_ID)
    await handle.trigger()
    return { success: true }
  } catch (error) {
    console.error('Error triggering GovernanceSync:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

/** @deprecated Use TriggerGovernanceSync instead */
export async function UpdateProvidersFromSource() {
  return TriggerGovernanceSync()
}

interface SubmitProvidersValues {
  providers: string[];
}

interface SubmitProvidersResult {
  errors?: Record<string, string[]>;
}

export async function submitProviders(
  values: SubmitProvidersValues,
  providers: Provider[]
): Promise<SubmitProvidersResult | void> {
  const userIdentity = await requireAuth()

  const validatedFields = updateProvidersSchema.safeParse(values);

  if (!validatedFields.success) {
    throw new Error("Invalid form data");
  }

  const updatedProviders = providers.map(({ id, ...provider }) => ({
    ...provider,
    enabled: values.providers.includes(provider.identity),
    visible: values.providers.includes(provider.identity),
    createdBy: userIdentity,
    updatedBy: userIdentity,
  }));

  await upsertProviders(updatedProviders);

  revalidatePath("/admin/setup");
}

export async function CountProviders() {
  return countProviders()
}

export async function ListProviders(all?: boolean) {
  return list(all);
}

export async function GetProviderByIdentity(identity: string) {
  return getByIdentity(identity);
}

export async function UpdateVisibility(identity: string, visible: boolean) {
  try {
    const updates = visible
      ? { visible }
      : { visible, enabled: false };

    await update(identity, updates);
  } catch (error) {
    console.log('UpdateVisibility: An error occurred while performing the update operation');
    console.error(error);
  }
}

export async function UpdateEnabled(identity: string, enabled: boolean) {
  try {
    await update(identity, { enabled });
  } catch (error) {
    console.log('UpdateEnabled: An error occurred while performing the update operation');
    console.error(error);
  }
}

type AddressGroup = {
  id: number;
  name: string;
  linkedAddresses: string[];
  private: boolean;
  relayMinerId: number;
  keysCount: number;
  relayMiner: {
    id: number;
    name: string;
    identity: string;
    regionId: number;
    domain: string;
    region: {
      id: number;
      displayName: string;
      urlValue: string;
    };
  };
  addressGroupServices: Array<{
    addressGroupId: number;
    serviceId: string;
    addSupplierShare: boolean;
    supplierShare: number;
    revShare: Array<{
      address: string;
      share: number;
    }>;
    service: {
      name: string;
    };
  }>;
  grossRewardsPerService?: Array<{ service_id: string; amount: string; [key: string]: unknown }>;
  rewardsSuppliersCount?: number;
  rewardsUpdatedAt?: string;
};

export interface ProviderWithPublicPlans {
  id: number;
  name: string;
  identity: string;
  status: ProviderStatus;
  addressGroups: AddressGroup[];
  supplierStats: { suppliers_count: number; total_staked_tokens: number } | null;
}

export async function ListProvidersWithPublicPlans(connectedAccounts: string[] = []): Promise<ProviderWithPublicPlans[]> {
  const providers = await list();
  const normalizedConnectedAccounts = connectedAccounts.map(addr => addr.toLowerCase());

  return providers
    .filter(provider => provider.enabled)
    .map(provider => {
      // Filter address groups to only include:
      // 1. Public ones (not private)
      // 2. If they have linked addresses, at least one must be in connected accounts
      const publicAddressGroups = (provider.addressGroups || []).filter(
        (group: AddressGroup) => {
          // Must not be private
          if (group.private !== false) {
            return false;
          }

          // If the group has linked addresses, check if any are connected
          if (group.linkedAddresses && group.linkedAddresses.length > 0) {
            const hasConnectedLinkedAddress = group.linkedAddresses.some(
              (addr: string) => normalizedConnectedAccounts.includes(addr.toLowerCase())
            );
            // Only include if a connected account is linked
            return hasConnectedLinkedAddress;
          }

          // No linked addresses means it's fully public
          return true;
        }
      );

      // Skip providers that don't have any public address groups
      if (publicAddressGroups.length === 0) {
        return null;
      }

      const result: ProviderWithPublicPlans = {
        id: provider.id,
        name: provider.name,
        identity: provider.identity,
        status: provider.status,
        addressGroups: publicAddressGroups,
        supplierStats: provider.supplierStats ?? null,
      };
      return result;
    })
    .filter((p): p is ProviderWithPublicPlans => p !== null);
}
