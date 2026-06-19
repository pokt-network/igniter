import { proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '../activities'
import type { ReturnFundsChoice } from '../activities'

type Args = { addresses: string[]; returnFunds: ReturnFundsChoice }

export async function CreateUnstakeIntents({ addresses, returnFunds }: Args) {
  const { createUnstakeIntent } = proxyActivities<ReturnType<typeof providerActivities>>({
    startToCloseTimeout: '30s',
    retry: { maximumAttempts: 3 },
  })
  for (const address of addresses) {
    await createUnstakeIntent({ keyAddress: address, returnFunds })
  }
}
