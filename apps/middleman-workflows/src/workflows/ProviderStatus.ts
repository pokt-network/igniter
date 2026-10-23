import { ApplicationFailure, log, proxyActivities } from "@temporalio/workflow";
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

  const results = await Promise.allSettled(
    providers.map((provider) => processProviderStatus(provider.identity))
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      log.warn("ProviderStatus: provider status activity failed", {
        identity: providers[i]!.identity,
        reason: String(r.reason),
      });
    }
  });

  // Match the SupplierStatus pattern: one unreachable provider must not fail the
  // run, but if every provider failed the problem is systemic (e.g. DB down) and
  // must surface as a workflow failure. Guard the empty list, where `every` is
  // vacuously true.
  const allFailed =
    results.length > 0 && results.every((r) => r.status === "rejected");
  if (allFailed) {
    throw new ApplicationFailure("ProviderStatus: all provider status activities failed", "fatal_error", true);
  }
}
