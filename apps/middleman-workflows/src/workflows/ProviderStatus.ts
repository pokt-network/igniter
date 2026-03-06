import { proxyActivities } from "@temporalio/workflow";
import { delegatorActivities } from '@/activities';

export interface ProviderStatusArgs {}

export async function ProviderStatus(args: ProviderStatusArgs) {
  const { listProviders, fetchProviderStatus, updateProviders, fetchSupplierAddressGroups, fetchAndStoreAddressGroupRewards } =
    proxyActivities<ReturnType<typeof delegatorActivities>>({
      startToCloseTimeout: "30s",
      retry: {
        maximumAttempts: 3,
      },
    });

  const providers = await listProviders();
  const providerStatus = await fetchProviderStatus(providers);

  await updateProviders(providerStatus);

  const supplierAddressGroups = await fetchSupplierAddressGroups(providers);
  await fetchAndStoreAddressGroupRewards(providers);

  return { providerStatus, supplierAddressGroups };
}
