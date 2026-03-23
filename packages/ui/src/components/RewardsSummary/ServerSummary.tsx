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
}

export default async function ServerSummary({
  addresses,
  supplierAddresses,
  noDataMessage,
  isOwners,
  graphQlUrl,
}: ServerSummaryProps) {
  let data, error = false

  if (addresses.length) {
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
