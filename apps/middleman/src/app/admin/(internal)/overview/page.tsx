import type { Metadata } from 'next'
import { getApplicationSettings, GetAppName } from '@/actions/ApplicationSettings'
import { getAllNodesSummary } from '@/lib/dal/nodes'
import InitializeHeightContext from '@igniter/ui/context/Height/InitializeContext'
import { Suspense } from 'react'
import SummaryLoader from '@igniter/ui/components/RewardsSummary/Loader'
import ServerSummary from '@igniter/ui/components/RewardsSummary/ServerSummary'
import RewardsByAddressesLoader from '@igniter/ui/components/RewardsByAddresses/Loader'
import ServerRewardsByAddresses from '@igniter/ui/components/RewardsByAddresses/ServerRewardsByAddresses'
import ApolloWrapper from '@igniter/ui/graphql/client'
import { GetStakedNodesAddress } from '@/actions/Nodes'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Admin Overview - ${appName}`,
  }
}

export default async function Page() {
  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Admin Overview</h1>
              <p className="text-text-secondary">
                View your delegator rewards and node activity at a glance.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className={'flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10'}>
        <Suspense
          fallback={(
            <>
              <div className={'min-w-[260px]'}>
                <SummaryLoader />
              </div>
              <RewardsByAddressesLoader chartType={'line'} />
            </>
          )}
        >
          <Rewards />
        </Suspense>
      </div>
    </>
  )
}

async function Rewards() {
  const [applicationSettings, stakedNodes, nodesSummary] = await Promise.all([
    getApplicationSettings(),
    GetStakedNodesAddress(),
    getAllNodesSummary(),
  ]);

  let graphqlUrl = applicationSettings.indexerApiUrl

  if (!graphqlUrl) {
    if (applicationSettings.chainId === 'pocket') {
      graphqlUrl = process.env.MAINNET_INDEXER_API_URL || ''
    } else if (applicationSettings.chainId === 'pocket-beta') {
      graphqlUrl = process.env.BETA_INDEXER_API_URL || ''
    } else {
      graphqlUrl = process.env.ALPHA_INDEXER_API_URL || ''
    }
  }
  const addresses = [applicationSettings.delegatorRewardsAddress!]

  return (
    <ApolloWrapper url={graphqlUrl}>
      <InitializeHeightContext graphQlUrl={graphqlUrl}>
        <div className={'min-w-[260px]'}>
          <Suspense
            key={addresses.join(',')}
            fallback={
              <SummaryLoader />
            }
          >
            <ServerSummary
              addresses={addresses}
              supplierAddresses={stakedNodes}
              isOwners={false}
              graphQlUrl={graphqlUrl}
              dbSuppliersCount={nodesSummary.count}
              dbStakedTokens={nodesSummary.totalStaked}
            />
          </Suspense>
        </div>

        <Suspense
          key={addresses.join(',')}
          fallback={
            <RewardsByAddressesLoader chartType={'line'} />
          }
        >
          <ServerRewardsByAddresses
            addresses={addresses}
            supplierAddresses={stakedNodes}
            graphQlUrl={graphqlUrl}
          />
        </Suspense>
      </InitializeHeightContext>
    </ApolloWrapper>
  )
}
