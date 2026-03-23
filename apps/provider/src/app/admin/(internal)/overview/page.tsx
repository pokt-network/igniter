import type { Metadata } from 'next'
import ApolloWrapper from '@igniter/ui/graphql/client'
import { GetAppName, GetApplicationSettings } from '@/actions/ApplicationSettings'
import InitializeHeightContext from '@igniter/ui/context/Height/InitializeContext'
import React, { Suspense } from 'react'
import SummaryLoader from '@igniter/ui/components/RewardsSummary/Loader'
import ServerSummary from '@igniter/ui/components/RewardsSummary/ServerSummary'
import RewardsByAddressesLoader from '@igniter/ui/components/RewardsByAddresses/Loader'
import ServerRewardsByAddresses from '@igniter/ui/components/RewardsByAddresses/ServerRewardsByAddresses'
import { getDistinctRevAddresses } from '@/lib/dal/services'
import { CircleAlert } from 'lucide-react'
import Link from 'next/link'
import { listStakedAddresses } from '@/lib/dal/keys'

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
        <div className="border-b-1">
          <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-10">
            <div className="flex flex-row justify-between items-center">
              <div className="flex flex-col">
                <h1>Admin Overview</h1>
              </div>
            </div>
          </div>
        </div>
        <Suspense
          fallback={(
            <>
              <div className={'flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10'}>
                <div className={'min-w-[260px]'}>
                  <SummaryLoader />
                </div>
                <RewardsByAddressesLoader chartType={'line'} />
              </div>
            </>
          )}
        >
          <Rewards />
        </Suspense>
    </>
  )
}

async function Rewards() {
  const [applicationSettings, addresses, supplierAddresses] = await Promise.all([
    GetApplicationSettings(),
    getDistinctRevAddresses(),
    listStakedAddresses()
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

  let rewardsContent: React.ReactNode

  if (addresses.length === 0) {
    rewardsContent = (
      <div className={'flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10'}>
        <div className={'flex flex-row p-6 gap-2 items-center border rounded-lg'}>
          <CircleAlert className={'h-16 w-16'} />
          <div className={'flex flex-col gap-0'}>
            <p className={'!text-lg font-bold'}>
              You do not have addresses configured.
            </p>
            <p>
              To see your rewards, please configure your addresses in{' '}
              <Link
                className={'!text-pnf-blue hover:!underline'}
                href={'/admin/groups'}
              >
                Addresses Group
              </Link>
            </p>
          </div>

        </div>
      </div>
    )
  } else {
    rewardsContent = (
      <div className={'flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10'}>
        <div className={'min-w-[260px]'}>
          <Suspense
            key={addresses.join(',')}
            fallback={
              <SummaryLoader />
            }
          >
            <ServerSummary
              addresses={addresses}
              supplierAddresses={supplierAddresses}
              isOwners={false}
              graphQlUrl={graphqlUrl}
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
            graphQlUrl={graphqlUrl}
            supplierAddresses={supplierAddresses}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <ApolloWrapper url={graphqlUrl}>
      <InitializeHeightContext graphQlUrl={graphqlUrl}>
        {rewardsContent}
      </InitializeHeightContext>
    </ApolloWrapper>
  )
}
