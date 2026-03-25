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
import { ListRegions } from '@/actions/Regions'
import { ListServices } from '@/actions/Services'
import { ListAddressGroups } from '@/actions/AddressGroups'
import { ListRelayMiners } from '@/actions/RelayMiners'
import { ListDelegators } from '@/actions/Delegators'

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
    getDistinctRevAddresses().catch(() => []),
    listStakedAddresses().catch(() => [])
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
    const counts = await Promise.all([
      ListRegions().then(r => r.success ? r.data.length : 0).catch(() => 0),
      ListRelayMiners().then(r => r.success ? r.data.length : 0).catch(() => 0),
      ListServices().then(r => r.success ? r.data.length : 0).catch(() => 0),
      ListAddressGroups().then(r => r.success ? r.data.length : 0).catch(() => 0),
      ListDelegators().then(r => r.success ? r.data.length : 0).catch(() => 0),
    ]);
    const [regionsCount, relayMinersCount, servicesCount, addressGroupsCount, delegatorsCount] = counts;

    rewardsContent = (
      <div className={'flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10'}>
        <div className="rounded-md p-5 flex flex-col gap-3" style={{ background: 'var(--bg-surface, rgba(255,255,255,0.03))', border: '1px solid var(--border-primary)' }}>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Network</span>
            <span className="text-sm">{applicationSettings.chainId}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">App Identity</span>
            <span className="text-sm font-mono">{applicationSettings.appIdentity}</span>
          </div>
          {applicationSettings.name && (
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-text-tertiary w-28 shrink-0">Provider Name</span>
              <span className="text-sm">{applicationSettings.name}</span>
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Node API</span>
            <span className="text-sm font-mono truncate">{applicationSettings.rpcUrl}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Indexer API</span>
            <span className="text-sm font-mono truncate">{applicationSettings.indexerApiUrl}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Min Stake</span>
            <span className="text-sm">{applicationSettings.minimumStake?.toLocaleString()} uPOKT</span>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Regions', count: regionsCount },
            { label: 'Relay Miners', count: relayMinersCount },
            { label: 'Services', count: servicesCount },
            { label: 'Address Groups', count: addressGroupsCount },
            { label: 'Delegators', count: delegatorsCount },
          ].map(({ label, count }) => (
            <div key={label} className="rounded-md p-3 text-center" style={{ background: 'var(--bg-surface, rgba(255,255,255,0.03))', border: '1px solid var(--border-primary)' }}>
              <p className="text-xl font-bold">{count}</p>
              <p className="text-xs text-text-tertiary mt-1">{label}</p>
            </div>
          ))}
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
