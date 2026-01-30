import type { Metadata } from 'next'
import { Suspense } from 'react';
import { GetOwnerAddresses, GetUserNodes } from '@/actions/Nodes'
import ApolloWrapper from '@igniter/ui/graphql/client'
import SummaryLoader from '@igniter/ui/components/RewardsSummary/Loader';
import ServerSummary from '@igniter/ui/components/RewardsSummary/ServerSummary'
import RewardsByAddressesLoader from '@igniter/ui/components/RewardsByAddresses/Loader'
import ServerRewardsByAddresses from '@igniter/ui/components/RewardsByAddresses/ServerRewardsByAddresses'
import { getApplicationSettings, GetAppName } from '@/actions/ApplicationSettings'
import InitializeHeightContext from '@igniter/ui/context/Height/InitializeContext'
import Link from 'next/link'
import { Button } from '@igniter/ui/components/button'

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Overview - ${appName}`,
  }
}

export default async function Page() {
  return (
    <>
      <div className={"border-b-1"}>
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-10">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Overview</h1>
              <p className="text-muted-foreground">
                Welcome to your $POKT staking dashboard.
              </p>
            </div>
            <div className="flex flex-col">
              <div className="flex flex-row gap-3">
                <Link href="/app/stake">
                  <Button>New Stake</Button>
                </Link>
              </div>
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
  const [ownerAddresses, userNodes, applicationSettings] = await Promise.all([
    GetOwnerAddresses(),
    GetUserNodes(),
    getApplicationSettings()
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

  const supplierAddresses = userNodes.map(n => n.address)

  return (
    <ApolloWrapper url={graphqlUrl}>
      <InitializeHeightContext graphQlUrl={graphqlUrl}>
        <div className={'min-w-[260px]'}>
          <Suspense
            key={ownerAddresses.join(',')}
            fallback={
              <SummaryLoader />
            }
          >
            <ServerSummary
              addresses={ownerAddresses}
              supplierAddresses={supplierAddresses}
              isOwners={true}
              graphQlUrl={graphqlUrl}
              noDataMessage={'You do not have any stake yet. Stake to start getting rewards.'}
            />
          </Suspense>
        </div>

        <Suspense
          key={ownerAddresses.join(',')}
          fallback={
            <RewardsByAddressesLoader chartType={'line'} />
          }
        >
          <ServerRewardsByAddresses
            addresses={ownerAddresses}
            supplierAddresses={supplierAddresses}
            graphQlUrl={graphqlUrl}
            noDataMessage={'You do not have any stake yet. Stake to start getting rewards.'}
          />
        </Suspense>
      </InitializeHeightContext>
    </ApolloWrapper>
  )
}
