'use server'

import { type ActionResult, requireOwner, withRequireOwner } from '@/lib/utils/actionUtils'
import { countKeysForUnstake, getUnstakeSummary, listKeysForUnstake, type UnstakeFilters } from '@/lib/dal/keys'
import { type ReturnFundsInput } from '@/lib/unstakeValidation'
import { getDbClient } from '@/db'
import { transactionsTable } from '@igniter/db/provider/schema'
import {
  RemediationHistoryEntryReason,
  TransactionStatus,
  TransactionTrigger,
  TransactionType,
} from '@igniter/db/provider/enums'
import { fromBech32 } from '@cosmjs/encoding'
import { z } from 'zod'
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
  const avgTimeToBlock = Number(data.blockStats?.at(0)?.avgTimeToBlockMs ?? 0)
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

  // A non-numeric indexer value would make durationSeconds NaN, which formatDuration
  // renders as the misleading "< 1m". Treat it as unavailable (UI shows "N/A") instead.
  if (!Number.isFinite(durationSeconds)) {
    return null
  }

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

function isPoktAccountAddress(value: string): boolean {
  try {
    const { prefix, data } = fromBech32(value)
    return prefix === 'pokt' && data.length === 20
  } catch {
    return false
  }
}

// The only return-funds shapes accepted, and only the parsed value is forwarded.
const returnFundsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('owner') }).strict(),
  z.object({
    mode: z.literal('custom'),
    address: z.string().trim().refine(isPoktAccountAddress, 'Invalid destination address'),
  }).strict(),
])

/**
 * Owner-gated unstake. Writes the unstake INTENT rows itself: this action is the
 * only place a `custom` drain destination can come from, and the provider-workflows
 * dispatcher re-reads it from the row by transaction id at sign time. The rows hold no
 * private key; the worker loads it from the keys table when it signs.
 *
 * Per key the pending-unique index (one pending tx per key) makes a repeat a no-op,
 * counted as `skipped`; retired keys are already excluded by listKeysForUnstake.
 */
export async function UnstakeKeys(
  input: { filters: UnstakeFilters; returnFunds: ReturnFundsInput },
): Promise<ActionResult<{ accepted: number; skipped: number }>> {
  return withRequireOwner(async () => {
    const parsed = returnFundsSchema.safeParse(input?.returnFunds)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid return funds choice')
    const returnFunds: ReturnFundsInput = parsed.data

    const keys = await listKeysForUnstake(input.filters)
    if (keys.length === 0) return { accepted: 0, skipped: 0 }

    const db = getDbClient().db
    let accepted = 0
    let skipped = 0
    for (const key of keys) {
      const [row] = await db.insert(transactionsTable)
        .values({
          keyId: key.id,
          keyAddress: key.address,
          type: TransactionType.Unstake,
          status: TransactionStatus.Pending,
          reason: RemediationHistoryEntryReason.ManualUnstake,
          trigger: TransactionTrigger.Manual,
          hash: null,
          executionHeight: null,
          params: JSON.stringify({
            kind: 'unstake',
            params: { signer: key.address, operatorAddress: key.address },
            returnFunds,
          }),
          reasons: JSON.stringify([]),
        })
        .onConflictDoNothing()
        .returning({ id: transactionsTable.id })
      if (row) accepted++
      else skipped++
    }
    return { accepted, skipped }
  })
}
