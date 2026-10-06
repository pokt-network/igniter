'use server'

import { NodeStatus } from '@igniter/db/middleman/enums'
import { countAllNodes, getAllNodes, getNode, getNodesByUser, getOwnerAddressesByUser, getProviderCountByUser, getStakedNodesAddress } from '@/lib/dal/nodes'
import { requireAuth, requireAdmin, assertOwnership } from "@/lib/utils/actions";
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { normalizeIdentityToAddress } from '@igniter/commons/crypto'
import { rewardsWindowsDocument } from '@igniter/graphql'
import { getServerApolloClient } from '@igniter/ui/graphql/server'
import { getLatestBlock } from '@igniter/ui/api/blocks'
import { amountToPokt } from '@igniter/ui/lib/utils'
import { batchArray } from '@igniter/ui/lib/batch'
import { unwrapRange } from '@igniter/ui/lib/range'
import { sumRewardTotals } from '@igniter/ui/lib/rewards'

export async function GetAllNodes() {
  await requireAdmin()
  return getAllNodes()
}

export async function CountAllNodes() {
  await requireAdmin()
  return countAllNodes()
}

export async function GetUserNodes() {
  const userIdentity = await requireAuth()
  return getNodesByUser(userIdentity)
}

export async function GetStakedNodesAddress() {
  const [userIdentity, applicationSettings] = await Promise.all([
    requireAuth(),
    getApplicationSettings()
  ])

  const normalizedOwnerIdentity = normalizeIdentityToAddress(applicationSettings.ownerIdentity)

  if (userIdentity !== normalizedOwnerIdentity) {
    throw new Error("Unauthorized")
  }

  return await getStakedNodesAddress()
}

export async function GetNode(address: string) {
  const [node, userIdentity] = await Promise.all([
    getNode(address),
    requireAuth()
  ])

  assertOwnership(node, userIdentity, 'createdBy', 'Node')
  return node
}

export async function GetOwnerAddresses() {
  const userIdentity = await requireAuth()
  return await getOwnerAddressesByUser(userIdentity)
}

export async function GetProviderCount(): Promise<number> {
  const userIdentity = await requireAuth()
  return await getProviderCountByUser(userIdentity)
}

export interface ProviderStakeData {
  identity: string
  name: string
  suppliers: number
  stakedPokt: number
}

// null: the provider's rewards could not be fetched (shown as N/A, never as 0)
export interface ProviderRewardsData {
  identity: string
  rewards24h: number | null
  rewards48h: number | null
}

export interface ProviderBreakdownData extends ProviderStakeData {
  rewards24h: number | null
  rewards48h: number | null
}

// Groups the staked nodes by provider, skipping nodes without a provider and providers
// without staked nodes (provider visibility).
type UserNode = Awaited<ReturnType<typeof GetUserNodes>>[number]

function groupStakedNodesByProvider(userNodes: UserNode[]) {
  const providerGroups = new Map<string, { name: string; nodes: UserNode[] }>()
  for (const node of userNodes) {
    if (!node.providerId || node.status !== NodeStatus.Staked) continue
    const name = node.provider?.name ?? node.providerId
    let group = providerGroups.get(node.providerId)
    if (!group) {
      group = { name, nodes: [] }
      providerGroups.set(node.providerId, group)
    }
    group.nodes.push(node)
  }
  return Array.from(providerGroups.entries())
}

/**
 * Suppliers and staked POKT per provider, from the database. Cheap, so the client polls it on
 * a short interval; the rewards columns come from GetProviderRewards.
 */
export async function GetProviderStakes(): Promise<ProviderStakeData[]> {
  const userNodes = await GetUserNodes()

  const providers: ProviderStakeData[] = groupStakedNodesByProvider(userNodes).map(([identity, group]) => ({
    identity,
    name: group.name,
    suppliers: group.nodes.length,
    stakedPokt: group.nodes.reduce(
      (sum, n) => sum + amountToPokt(n.stakeAmount),
      0,
    ),
  }))

  providers.sort((a, b) => b.suppliers - a.suppliers)
  return providers
}

const BLOCK_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/
// Accepted range of a client timestamp, against the server clock (not the cached latest block,
// which unstable_cache can serve stale for as long as nobody requests it): at most 2 min ahead,
// and no older than the 48 h window plus a margin.
const MAX_BLOCK_TIMESTAMP_AHEAD_MS = 2 * 60 * 1000
const MAX_BLOCK_TIMESTAMP_AGE_MS = 49 * 60 * 60 * 1000

// Parses an indexer block timestamp, which may come without the trailing Z. The value comes
// from the client, so anything that is not that exact shape is rejected.
function parseBlockTimestamp(timestamp: unknown): Date | null {
  if (typeof timestamp !== 'string' || !BLOCK_TIMESTAMP_PATTERN.test(timestamp)) return null
  const date = new Date(timestamp.endsWith('Z') ? timestamp : timestamp + 'Z')
  const now = Date.now()
  if (Number.isNaN(date.getTime())) return null
  if (date.getTime() > now + MAX_BLOCK_TIMESTAMP_AHEAD_MS || date.getTime() < now - MAX_BLOCK_TIMESTAMP_AGE_MS) return null
  return date
}

/**
 * @param blockTimestamp - Timestamp of the block the client read its settlement height from.
 * The rewards windows end there, so a refetch triggered by a new settlement always includes it;
 * the cached latest block could predate it. Falls back to the latest block when absent, malformed,
 * or outside the accepted range around the server clock.
 */
export async function GetProviderRewards(blockTimestamp?: string): Promise<ProviderRewardsData[]> {
  const [userNodes, ownerAddresses, applicationSettings] = await Promise.all([
    GetUserNodes(),
    GetOwnerAddresses(),
    getApplicationSettings(),
  ])

  // Resolve graphQL URL
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

  const providerEntries = groupStakedNodesByProvider(userNodes)
  const client = getServerApolloClient(graphqlUrl)

  const blockDate =
    parseBlockTimestamp(blockTimestamp) ??
    new Date((await getLatestBlock(graphqlUrl)).timestamp)
  const currentDate = blockDate.toISOString()
  const last24Hours = new Date(blockDate.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const last48Hours = new Date(blockDate.getTime() - 48 * 60 * 60 * 1000).toISOString()

  const results = await Promise.allSettled(
    providerEntries.map(async ([, group]) => {
      const supplierAddresses: Array<string> = group.nodes.map((n) => n.address)
      const batches = batchArray(supplierAddresses)

      const batchResults = await Promise.all(
        batches.map((batch) =>
          client.query({
            query: rewardsWindowsDocument,
            variables: {
              currentDate,
              last24Hours,
              last48Hours,
              addresses: ownerAddresses,
              supplierAddresses: batch,
            },
          }),
        ),
      )

      // Either indexer shape (see range.ts); null when nothing in the window is covered
      return {
        last24h: unwrapRange<number>(sumRewardTotals(batchResults.map(({ data: d }) => d.last24h))).data,
        last48h: unwrapRange<number>(sumRewardTotals(batchResults.map(({ data: d }) => d.last48h))).data,
      }
    }),
  )

  return providerEntries.map(([identity], index) => {
    const result = results[index]
    const data = result?.status === 'fulfilled' ? result.value : null

    return {
      identity,
      rewards24h: data?.last24h != null ? amountToPokt(data.last24h) : null,
      rewards48h: data?.last48h != null ? amountToPokt(data.last48h) : null,
    }
  })
}
