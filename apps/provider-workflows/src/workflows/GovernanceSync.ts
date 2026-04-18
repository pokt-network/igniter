import { proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'

const { syncDelegatorsFromGovernance } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
  },
})

const { sendNotifications: sendNotificationsBestEffort } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 1 },
})

export async function GovernanceSync() {
  const result = await syncDelegatorsFromGovernance()

  const total = result.inserted + result.updated + result.disabled
  if (total > 0) {
    await sendNotificationsBestEffort({
      type: 'delegators_synced',
      summary: {
        title: 'Delegators Synced',
        body: [
          `Governance sync completed with ${total} change${total > 1 ? 's' : ''}.`,
          result.inserted > 0 ? `\n• ${result.inserted} new delegator${result.inserted > 1 ? 's' : ''} added` : '',
          result.updated > 0 ? `\n• ${result.updated} delegator${result.updated > 1 ? 's' : ''} updated` : '',
          result.disabled > 0 ? `\n• ${result.disabled} delegator${result.disabled > 1 ? 's' : ''} disabled` : '',
        ].join(''),
      },
      metadata: { inserted: result.inserted, updated: result.updated, disabled: result.disabled },
    })
  }

  return result
}
