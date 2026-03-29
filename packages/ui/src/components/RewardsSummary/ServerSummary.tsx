import { summaryVariables } from './operations'
import Summary from './Summary'
import { getLatestBlock } from '../../api/blocks'
import { getServerApolloClient } from '../../lib/graphql/server'
import { summaryDocument } from '@igniter/graphql/rewards'
import { batchArray } from '../../lib/batch'

interface ServerSummaryProps {
  addresses: Array<string>
  supplierAddresses: Array<string>
  isOwners: boolean
  graphQlUrl: string
  noDataMessage?: string
  dbSuppliersCount?: number
  dbStakedTokens?: number
}

export default async function ServerSummary({
  addresses,
  supplierAddresses,
  noDataMessage,
  isOwners,
  graphQlUrl,
  dbSuppliersCount,
  dbStakedTokens,
}: ServerSummaryProps) {
  let data, error = false

  if (addresses.length && graphQlUrl) {
    try {
      const latestBlock = await getLatestBlock(graphQlUrl)
      const client = getServerApolloClient(graphQlUrl)
      const batches = batchArray(supplierAddresses)

      const results = await Promise.all(
        batches.map((batch) =>
          client.query({
            query: summaryDocument,
            variables: summaryVariables(
              isOwners,
              addresses,
              batch,
              latestBlock.timestamp,
            ),
          }),
        ),
      )

      // Aggregate results across batches
      data = results.reduce(
        (acc, { data: d }) => {
          if (!acc) return d
          return {
            ...d,
            suppliers: {
              ...d.suppliers,
              totalCount:
                (acc.suppliers?.totalCount ?? 0) +
                (d.suppliers?.totalCount ?? 0),
              aggregates: {
                ...d.suppliers?.aggregates,
                sum: {
                  stakeAmount:
                    Number(acc.suppliers?.aggregates?.sum?.stakeAmount ?? 0) +
                    Number(d.suppliers?.aggregates?.sum?.stakeAmount ?? 0),
                },
              },
            },
            last24h:
              Number(acc.last24h ?? 0) + Number(d.last24h ?? 0),
            last48h:
              Number(acc.last48h ?? 0) + Number(d.last48h ?? 0),
          }
        },
        null as typeof results[0]['data'] | null,
      )
    } catch {
      error = true
    }
  }

  // Override suppliers count and staked tokens with DB data when available
  // The DB is the source of truth for these values — the indexer may be behind or unavailable
  if (dbSuppliersCount !== undefined || dbStakedTokens !== undefined) {
    const indexerRewards = data ? { last24h: data.last24h, last48h: data.last48h } : { last24h: null, last48h: null }
    data = {
      ...data,
      suppliers: {
        ...data?.suppliers,
        totalCount: dbSuppliersCount ?? 0,
        aggregates: {
          ...data?.suppliers?.aggregates,
          sum: {
            stakeAmount: dbStakedTokens ?? 0,
          },
        },
      },
      ...indexerRewards,
    } as typeof data
    error = false
  }

  return (
    <Summary
      isOwners={isOwners}
      addresses={addresses}
      supplierAddresses={supplierAddresses}
      noDataMessage={noDataMessage}
      initialError={error}
      initialData={data || null}
    />
  )
}
