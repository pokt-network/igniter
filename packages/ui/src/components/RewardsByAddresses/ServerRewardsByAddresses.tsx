import { cookies } from 'next/headers'
import {
  rewardsByAddressAndTimeGroupByDateVariables,
} from './operations'
import DataProvider from '../../context/data'
import { ChartTypeProvider } from '../BaseLineBarChart/ChartType'
import { chartTypeCookieKey, timeSelectedCookieKey } from './constants'
import RewardsByAddressCard from './Card'
import RewardsByAddressChart from './RewardsByAddressChart'
import CardActions from './CardActions'
import { GroupAllProvider } from './GroupAllSwitch'
import { rewardsByAddressAndTimeGroupByDateDocument } from '@igniter/graphql/rewards'
import { getLatestBlock } from '../../api/blocks'
import { getServerApolloClient } from '../../lib/graphql/server'
import { getValidTime, Time } from '../../lib/dates'
import { SelectedTimeProvider } from './TimeSelector'
import { batchArray } from '../../lib/batch'

interface RewardsByAddressesProps {
  addresses: Array<string>
  supplierAddresses: Array<string>
  graphQlUrl: string
  noDataMessage?: string
}

export default async function ServerRewardsByAddresses({
  addresses,
  supplierAddresses,
  graphQlUrl,
  noDataMessage,
}: RewardsByAddressesProps) {
  let
    data,
    variables,
    error = false,
    chartType: 'line' | 'bar' = 'line',
    timeSelected = Time.Last7d

  if (addresses.length) {
    try {
      const cookiesAwaited = await cookies()
      const timeSelected = getValidTime(
        cookiesAwaited.get(timeSelectedCookieKey)?.value || ''
      )
      chartType = cookiesAwaited?.get(chartTypeCookieKey)?.value === 'bar' ? 'bar' : 'line'

      const latestBlock = await getLatestBlock(graphQlUrl)
      const client = getServerApolloClient(graphQlUrl)
      const batches = batchArray(supplierAddresses)

      // Use first batch's variables as the canonical variables for client-side refresh
      variables = rewardsByAddressAndTimeGroupByDateVariables(
        addresses,
        batches[0] ?? [],
        latestBlock.timestamp,
        timeSelected,
      )

      const results = await Promise.all(
        batches.map((batch) =>
          client.query({
            query: rewardsByAddressAndTimeGroupByDateDocument,
            variables: rewardsByAddressAndTimeGroupByDateVariables(
              addresses,
              batch,
              latestBlock.timestamp,
              timeSelected,
            ),
          }),
        ),
      )

      // Aggregate: concatenate the rewards JSON arrays from each batch
      data = results.reduce(
        (acc, { data: d }) => {
          if (!acc) return d
          const accRewards = Array.isArray(acc.rewards) ? acc.rewards : []
          const dRewards = Array.isArray(d.rewards) ? d.rewards : []
          return { ...d, rewards: [...accRewards, ...dRewards] }
        },
        null as typeof results[0]['data'] | null,
      )
    } catch {
      error = true
    }
  }

  return (
    <ChartTypeProvider
      defaultChartType={chartType}
    >
      <SelectedTimeProvider
        defaultTime={timeSelected}
      >
        <DataProvider
          initialData={[]}
        >
          <GroupAllProvider>
            <RewardsByAddressCard
              actions={(
                <CardActions />
              )}
            >
              <RewardsByAddressChart
                initialError={error}
                addresses={addresses}
                supplierAddresses={supplierAddresses}
                noDataMessage={noDataMessage}
                initialData={data || null}
                initialVariables={variables || null}
              />
            </RewardsByAddressCard>
          </GroupAllProvider>
        </DataProvider>
      </SelectedTimeProvider>
    </ChartTypeProvider>
  )
}
