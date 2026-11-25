import { ApplicationFailure, proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '../activities'
import type { ReturnFundsInputChoice } from '../activities'

type Args = { addresses: string[]; returnFunds: ReturnFundsInputChoice }

/**
 * Starts unstake intents for keys the caller names. Workflow inputs are not trusted to
 * choose a fund destination, so `returnFunds` is limited to `owner` / `none` (re-checked
 * inside the activity): a custom destination is accepted only when the provider app
 * writes the intent row itself, from its owner-gated Unstake action.
 */
export async function CreateUnstakeIntents({ addresses, returnFunds }: Args) {
  const mode = (returnFunds as { mode?: unknown } | undefined)?.mode
  if (mode !== 'owner' && mode !== 'none') {
    throw ApplicationFailure.nonRetryable('returnFunds must be { mode: "owner" } or { mode: "none" }', 'invalid_return_funds')
  }
  const { createUnstakeIntent } = proxyActivities<ReturnType<typeof providerActivities>>({
    startToCloseTimeout: '30s',
    retry: { maximumAttempts: 3 },
  })
  for (const address of addresses) {
    await createUnstakeIntent({ keyAddress: address, returnFunds: { mode } })
  }
}
