import { proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'

const { syncDelegatorsFromGovernance } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
  },
})

export async function GovernanceSync() {
  return syncDelegatorsFromGovernance()
}
