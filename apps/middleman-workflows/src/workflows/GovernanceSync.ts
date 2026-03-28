import { proxyActivities } from '@temporalio/workflow'
import type { governanceActivities } from '@/activities'

const { syncProvidersFromGovernance } = proxyActivities<ReturnType<typeof governanceActivities>>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
  },
})

export async function GovernanceSync() {
  return syncProvidersFromGovernance()
}
