import { proxyActivities } from "@temporalio/workflow";
import { delegatorActivities } from '@/activities';

export interface ProviderStatusArgs {}

export async function ProviderStatus(args: ProviderStatusArgs) {
  const { listProviders, processProviderStatus } =
    proxyActivities<ReturnType<typeof delegatorActivities>>({
      startToCloseTimeout: "120s",
      retry: {
        maximumAttempts: 3,
      },
    });

  const providers = await listProviders();

  await Promise.all(
    providers.map((provider) => processProviderStatus(provider.identity))
  );
}
