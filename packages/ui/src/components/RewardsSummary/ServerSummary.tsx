import { summaryVariables } from './operations'
import Summary, { type SuppliersSummary, type SummaryRewards } from './Summary'
import { getStatusQuery } from '../../api/blocks'
import { getServerApolloClient } from '../../lib/graphql/server'
import { rewardsWindowsDocument } from '@igniter/graphql/rewards'
import { batchArray } from '../../lib/batch'
import { combineRewardsWindows } from '../../lib/rewards'
import { getLogger } from '@igniter/logger'

const log = getLogger(['ui', 'rewards-summary'])

interface ServerSummaryProps {
  addresses: Array<string>
  supplierAddresses: Array<string>
  graphQlUrl: string
  noDataMessage?: string
  // Suppliers count and staked tokens (upokt) from igniter's DB, the source of truth for them, and
  // the server action that reads them again for the 60 s refresh
  dbSuppliersCount: number
  dbStakedTokens: number
  refreshSuppliers: () => Promise<SuppliersSummary>
}

export default async function ServerSummary({
  addresses,
  supplierAddresses,
  noDataMessage,
  graphQlUrl,
  dbSuppliersCount,
  dbStakedTokens,
  refreshSuppliers,
}: ServerSummaryProps) {
  let rewards: SummaryRewards | null = null

  if (addresses.length && graphQlUrl) {
    try {
      // Same cached status as the height context. Its block and settlement height are separate reads
      // (one request is not one snapshot), so the window can end a block before that settlement; the
      // next settlement refetch covers it.
      const latestBlock = await getStatusQuery(graphQlUrl)
      const client = getServerApolloClient(graphQlUrl)
      const batches = batchArray(supplierAddresses)

      const results = await Promise.all(
        batches.map((batch) =>
          client.query({
            query: rewardsWindowsDocument,
            variables: summaryVariables(
              addresses,
              batch,
              latestBlock.timestamp,
            ),
          }),
        ),
      )

      // The rewards totals, normalised once (see range.ts), are what crosses to the client
      rewards = combineRewardsWindows(results.map((r) => r.data))
    } catch (e) {
      // Missing rewards show N/A, and Summary retries them; the cause tells a broken query from an outage
      log.error('Failed to fetch the rewards summary', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Suppliers count and staked tokens come from the DB only (here and in Summary's refresh): the
  // indexer is not asked for them
  return (
    <Summary
      addresses={addresses}
      supplierAddresses={supplierAddresses}
      noDataMessage={noDataMessage}
      suppliers={{ count: dbSuppliersCount, stakeUpokt: dbStakedTokens }}
      refreshSuppliers={refreshSuppliers}
      initialRewards={rewards ?? { last24h: null, last48h: null }}
    />
  )
}
