'use server'

import { type ActionResult, requireOwner, withRequireOwner } from '@/lib/utils/actionUtils'
import { countKeysForUnstake, getUnstakeSummary, listKeysForUnstake, type UnstakeFilters } from '@/lib/dal/keys'
import { getTemporalClient, getTemporalConfig } from '@/lib/temporal'
import { validateReturnFunds, type ReturnFundsInput } from '@/lib/unstakeValidation'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { unstakeTimeAvgDocument } from '@igniter/graphql'
import { getServerApolloClient } from '@igniter/ui/graphql/server'
import { getStartAndEndDateBasedOnTime, Time } from '@igniter/ui/lib/dates'
import { getLatestBlock } from '@igniter/ui/api/blocks'

export interface UnstakeDurationData {
  durationSeconds: number;
  numBlocksPerSession: number;
  supplierUnbondingPeriodSessions: number;
  avgBlockTimeSeconds: number;
}

/**
 * Calculates the estimated unstake duration in seconds
 * Formula: num_blocks_per_session * supplier_unbonding_period_sessions * (timeToBlock / 1000)
 *
 * Returns the plain duration shape (not wrapped in ActionResult) so the client can
 * consume it directly via useQuery; null when the indexer API URL is unset.
 */
export async function GetUnstakeDuration(): Promise<UnstakeDurationData | null> {
  const authResult = await requireOwner()
  if (!authResult.success) {
    throw new Error(authResult.error.message)
  }

  const applicationSettings = await getApplicationSettings()

  if (!applicationSettings?.indexerApiUrl) {
    // Duration is display-only (estimated unbonding time). Without the indexer
    // configured, return null instead of throwing so the unstake flow still works.
    return null
  }

  const latestBlock = await getLatestBlock(applicationSettings.indexerApiUrl)

  const { start, end } = getStartAndEndDateBasedOnTime(latestBlock.timestamp, Time.Last30d)

  const client = getServerApolloClient(applicationSettings.indexerApiUrl)

  const { data } = await client.query({
    query: unstakeTimeAvgDocument,
    variables: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
  })

  // Extract average time to block
  const avgTimeToBlock = data.blocks?.aggregates?.average?.timeToBlock
  if (!avgTimeToBlock) {
    throw new Error('Failed to calculate average block time')
  }

  // Extract parameters
  const params = data.params?.nodes || []
  const numBlocksPerSession = params.find(p => p?.key === 'num_blocks_per_session')
  const unbondingPeriodSessions = params.find(p => p?.key === 'supplier_unbonding_period_sessions')

  if (!numBlocksPerSession?.value || !unbondingPeriodSessions?.value) {
    throw new Error('Failed to retrieve network parameters')
  }

  // Calculate duration in seconds
  const blocksPerSession = Number(numBlocksPerSession.value)
  const unbondingSessions = Number(unbondingPeriodSessions.value)
  const timeToBlockSeconds = avgTimeToBlock / 1000

  const durationSeconds = blocksPerSession * unbondingSessions * timeToBlockSeconds

  return {
    durationSeconds,
    numBlocksPerSession: blocksPerSession,
    supplierUnbondingPeriodSessions: unbondingSessions,
    avgBlockTimeSeconds: timeToBlockSeconds,
  }
}

export async function CountKeysForUnstake(filters: UnstakeFilters): Promise<ActionResult<number>> {
  return withRequireOwner(async () => {
    return countKeysForUnstake(filters)
  })
}

export async function GetUnstakeSummary(
  filters: UnstakeFilters,
): Promise<ActionResult<{ count: number; totalStakeUpokt: number; totalResidualUpokt: number }>> {
  return withRequireOwner(async () => {
    return getUnstakeSummary(filters)
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
