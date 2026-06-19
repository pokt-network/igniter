'use server'

import { type ActionResult, withRequireOwner } from '@/lib/utils/actionUtils'
import { countKeysForUnstake, listKeysForUnstake, type UnstakeFilters } from '@/lib/dal/keys'
import { getTemporalClient, getTemporalConfig } from '@/lib/temporal'
import { validateReturnFunds, type ReturnFundsInput } from '@/lib/unstakeValidation'

export async function CountKeysForUnstake(filters: UnstakeFilters): Promise<ActionResult<number>> {
  return withRequireOwner(async () => {
    return countKeysForUnstake(filters)
  })
}

export async function ListUnstakeAddresses(filters: UnstakeFilters): Promise<ActionResult<string[]>> {
  return withRequireOwner(async () => {
    const keys = await listKeysForUnstake(filters)
    return keys.map((k) => k.address)
  })
}

export async function UnstakeKeys(
  input: { filters: UnstakeFilters; returnFunds: ReturnFundsInput },
): Promise<ActionResult<{ accepted: number; skipped: number }>> {
  return withRequireOwner(async () => {
    const v = validateReturnFunds(input.returnFunds)
    if (!v.ok) throw new Error(v.message)

    const keys = await listKeysForUnstake(input.filters)
    if (keys.length === 0) return { accepted: 0, skipped: 0 }

    const client = getTemporalClient()
    const { taskQueue } = getTemporalConfig()
    let accepted = 0
    let skipped = 0
    for (const key of keys) {
      // Start (or no-op) a workflow that creates the unstake INTENT for this key.
      // The dispatcher/verifier sweeps complete the broadcast + drain durably.
      try {
        await client.workflow.start('CreateUnstakeIntents', {
          taskQueue,
          workflowId: `unstake-${key.address}`,
          args: [{ addresses: [key.address], returnFunds: input.returnFunds }],
        })
        accepted++
      } catch (e: any) {
        if (e?.name === 'WorkflowExecutionAlreadyStartedError') skipped++
        else throw e
      }
    }
    return { accepted, skipped }
  })
}
