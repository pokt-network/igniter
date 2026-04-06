"use server";

import {countProviders, list, listAll, upsertProviders, applyGovernanceSync, getByIdentity, update} from "@/lib/dal/providers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, requireAuth } from '@/lib/utils/actions'
import {ProviderStatus, UserRole} from "@igniter/db/middleman/enums";
import { getApplicationSettings } from '@/lib/dal/applicationSettings'

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

type CdnProvider = { name: string; identity: string; identityHistory: string[]; url: string }

// This is here because when doing the setup, the middleman workflows can not start running because the app is not bootstrapped
// so we cannot call TriggerGovernanceSync at setup time
export async function SyncProvidersFromGovernance(): Promise<{ success: boolean; error?: string; data?: Provider[] }> {
  try {
    const user = await getCurrentUser()

    if (![UserRole.Owner].includes(user.role)) {
      throw new Error('Forbidden')
    }

    const cdnUrlTemplate = process.env.PROVIDERS_CDN_URL
    if (!cdnUrlTemplate) {
      return { success: false, error: 'PROVIDERS_CDN_URL environment variable is not defined' }
    }

    const settings = await getApplicationSettings()
    const cdnUrl = cdnUrlTemplate.replace('{chainId}', settings.chainId.replace('lego-testnet', 'beta'))

    const response = await fetch(cdnUrl)
    if (!response.ok) {
      return { success: false, error: `Failed to fetch providers from CDN: ${response.statusText}` }
    }

    const cdnProviders = (await response.json()) as CdnProvider[]
    const current = await listAll()
    const currentMap = new Map(current.map((p) => [p.identity, p]))

    const allCdnIdentities = new Set<string>()
    for (const p of cdnProviders) {
      allCdnIdentities.add(p.identity)
      p.identityHistory.forEach((h) => allCdnIdentities.add(h))
    }

    const toInsert: { name: string; identity: string; url: string }[] = []
    const toUpdate: { id: number; name: string; identity: string; url: string }[] = []

    for (const cdnProvider of cdnProviders) {
      const possibleIds = [cdnProvider.identity, ...cdnProvider.identityHistory]
      const matchingCurrent = possibleIds.map((id) => currentMap.get(id)).find(Boolean) ?? null

      if (matchingCurrent) {
        if (
          matchingCurrent.identity !== cdnProvider.identity ||
          matchingCurrent.name !== cdnProvider.name ||
          matchingCurrent.url !== cdnProvider.url
        ) {
          toUpdate.push({ id: matchingCurrent.id, identity: cdnProvider.identity, name: cdnProvider.name, url: cdnProvider.url })
        }
      } else {
        toInsert.push({ identity: cdnProvider.identity, name: cdnProvider.name, url: cdnProvider.url })
      }
    }

    await applyGovernanceSync(toInsert, toUpdate, user.identity)

    const providers = await list(true)
    return { success: true, data: providers }
  } catch (error) {
    console.error('Error syncing providers from governance:', error)
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
