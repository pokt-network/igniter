import { log, proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'
import type { RecoverStaleDeliveredKeysResult } from '@/activities'

const { recoverStaleDeliveredKeys } = proxyActivities<ReturnType<typeof providerActivities>>({
  startToCloseTimeout: '120s',
  retry: {
    maximumAttempts: 3,
  },
})

/**
 * Workflow that recovers keys stuck in "delivered" state for more than 24 hours.
 * Keys are transitioned to "staked" if the supplier exists on-chain,
 * or to "available" if no supplier exists.
 */
export async function DeliveredKeyRecovery(): Promise<RecoverStaleDeliveredKeysResult> {
  log.info('DeliveredKeyRecovery: Execution started')
  const result = await recoverStaleDeliveredKeys()
  log.info('DeliveredKeyRecovery: Execution finished', { ...result })
  return result
}
