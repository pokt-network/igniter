'use server'

import { getApplicationSettings } from '@/actions/ApplicationSettings'
import { unstakeTimeAvgDocument } from '@igniter/graphql'
import { getServerApolloClient } from '@igniter/ui/graphql/server'
import { getStartAndEndDateBasedOnTime, Time } from '@igniter/ui/lib/dates'
import { getLatestBlock } from '@igniter/ui/api/blocks'
import { SignedTransaction } from '@igniter/ui/models'
import { requireAuth } from '@/lib/utils/actions'
import { InsertTransaction } from '@igniter/db/middleman/schema'
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import { insert } from '@/lib/dal/transaction'
import { sumStakeAmountByAddresses } from '@/lib/dal/nodes'
import { extractTransactionUnstakingSuppliers } from '@igniter/commons/transactions/extractSuppliers'
import { getLogger } from '@igniter/logger'
import { runWithRequestContext } from '@/lib/logging/withLogging'

const log = getLogger(['middleman', 'unstake'])

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
export async function GetUnstakeDuration(): Promise<UnstakeDurationData | null> {
  const applicationSettings = await getApplicationSettings()

  if (!applicationSettings?.indexerApiUrl) {
    // Duration is display-only (estimated unbonding time). Without the indexer
    // configured, return null instead of throwing so the unstake flow still works.
    return null
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
  return runWithRequestContext(async () => {
    const userIdentity = await requireAuth()

    log.info('unstake transaction requested', {
      ownerAddress: request.transaction.address,
      estimatedFee: request.transaction.estimatedFee,
    })

    // MsgUnstakeSupplier carries no amount, so "Total POKT" cannot be recovered
    // from the payload later. Derive it now, while the suppliers are still
    // Staked and their stakeAmount is intact. Derived server-side rather than
    // taken from the client: the payload is authoritative about which suppliers
    // are being unstaked, and their stake is already in our own database.
    const unstakingSuppliers = extractTransactionUnstakingSuppliers({
      unsignedPayload: request.transaction.unsignedPayload,
    })

    // Isolated so a display-only field can never abort the unstake. The user has
    // already signed by this point and the dialog is past its cancellable phase,
    // so a throw here would discard a signed transaction over a cosmetic query.
    // Scoped to the caller as well: the payload is client-supplied, and an
    // unscoped sum would let a crafted one total up another account's suppliers.
    let amount: string | null = null

    try {
      amount = await sumStakeAmountByAddresses(
        unstakingSuppliers.map((supplier) => supplier.operatorAddress),
        { createdBy: userIdentity },
      )
    } catch (error) {
      log.warn('could not derive unstake amount; storing null', { error })
    }

    const created = await insert({
      type: TransactionType.Unstake,
      status: TransactionStatus.Pending,
      signedPayload: request.transaction.signedPayload,
      fromAddress: request.transaction.address,
      unsignedPayload: request.transaction.unsignedPayload,
      estimatedFee: request.transaction.estimatedFee,
      consumedFee: 0,
      amount,
      createdBy: userIdentity,
    })

    log.info('unstake transaction created', {
      transactionId: created.id,
      ownerAddress: request.transaction.address,
      supplierCount: unstakingSuppliers.length,
      amount,
    })

    return created
  })
}
