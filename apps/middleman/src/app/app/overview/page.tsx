import type { Metadata } from 'next'
import { NodeWithDetails } from '@igniter/db/src/middleman/schema'
import React, { Suspense } from 'react';
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
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import ProviderBreakdown from './ProviderBreakdown'

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
      <PageHeader
        title="Overview"
        subtitle="Welcome to your $POKT staking dashboard."
        actions={
          <>
            <Link href="/app/stake">
              <Button>New Stake</Button>
            </Link>
            <Link href="/app/import-suppliers">
              <Button className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90">Import Suppliers</Button>
            </Link>
          </>
        }
      />
      <PageContent>
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
      </PageContent>
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

  const supplierAddresses = userNodes.map((n: NodeWithDetails) => n.address)
  const providerCount = new Set(userNodes.map((n: NodeWithDetails) => n.providerId).filter(Boolean)).size
  const dbSuppliersCount = userNodes.length
  const dbStakedTokens = userNodes.reduce((sum: number, n: NodeWithDetails) => sum + Number(n.stakeAmount || 0), 0)


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
              dbSuppliersCount={dbSuppliersCount}
              dbStakedTokens={dbStakedTokens}
            />
          </Suspense>
        </div>

        <ProviderBreakdown providerCount={providerCount} />

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

