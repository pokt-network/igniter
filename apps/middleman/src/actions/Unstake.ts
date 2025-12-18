'use server'

import { getApplicationSettings } from '@/actions/ApplicationSettings'
import { unstakeTimeAvgDocument } from '@igniter/graphql'
import { getServerApolloClient } from '@igniter/ui/graphql/server'
import { getStartAndEndDateBasedOnTime, Time } from '@igniter/ui/lib/dates'
import { getLatestBlock } from '@igniter/ui/api/blocks'
import { SignedTransaction } from '@igniter/ui/models'
import { getCurrentUserIdentity } from '@/lib/utils/actions'
import { InsertTransaction } from '@igniter/db/middleman/schema'
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import { insert } from '@/lib/dal/transaction'

export interface UnstakeDurationData {
  durationSeconds: number;
  numBlocksPerSession: number;
  supplierUnbondingPeriodSessions: number;
  avgBlockTimeSeconds: number;
}

/**
 * Calculates the estimated unstake duration in seconds
 * Formula: num_blocks_per_session * supplier_unbonding_period_sessions * (timeToBlock / 1000)
 */
export async function GetUnstakeDuration(): Promise<UnstakeDurationData> {
  const applicationSettings = await getApplicationSettings()

  if (!applicationSettings?.indexerApiUrl) {
    throw new Error('GraphQL API URL not configured')
  }

  const latestBlock = await getLatestBlock(applicationSettings.indexerApiUrl)

  const {start, end} = getStartAndEndDateBasedOnTime(latestBlock.timestamp, Time.Last30d)

  const client = getServerApolloClient(applicationSettings.indexerApiUrl)

  const { data } = await client.query({
    query: unstakeTimeAvgDocument,
    variables: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }
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

export interface CreateUnstakeTransactionRequest {
  transaction: SignedTransaction;
}

export async function CreateUnstakeTransaction(request: CreateUnstakeTransactionRequest) {
  const userIdentity = await getCurrentUserIdentity()

  const creatingTransaction: InsertTransaction = {
    type: TransactionType.Unstake,
    status: TransactionStatus.Pending,
    signedPayload: request.transaction.signedPayload,
    fromAddress: request.transaction.address,
    unsignedPayload: request.transaction.unsignedPayload,
    estimatedFee: request.transaction.estimatedFee,
    consumedFee: 0,
    createdBy: userIdentity,
  }

  return insert(creatingTransaction)
}
