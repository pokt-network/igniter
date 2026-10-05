'use server'

import type { NodeWithDetails } from '@igniter/db/middleman/schema'
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

export interface ProviderBreakdownData {
  identity: string
  name: string
  suppliers: number
  stakedPokt: number
  rewards24h: number
  rewards48h: number
}

const BLOCK_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/
// How far past the (cached) latest block a client timestamp may be: the cache lags by up to
// its 20 s revalidation plus the blocks produced meanwhile.
const MAX_BLOCK_TIMESTAMP_LEAD_MS = 5 * 60 * 1000

// Parses an indexer block timestamp, which may come without the trailing Z. The value comes
// from the client, so anything that is not that exact shape is rejected.
function parseBlockTimestamp(timestamp: unknown): Date | null {
  if (typeof timestamp !== 'string' || !BLOCK_TIMESTAMP_PATTERN.test(timestamp)) return null
  const date = new Date(timestamp.endsWith('Z') ? timestamp : timestamp + 'Z')
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * @param blockTimestamp - Timestamp of the block the client read its settlement height from.
 * The rewards windows end there, so a refetch triggered by a new settlement always includes it;
 * the cached latest block could predate it. Falls back to the latest block when absent, malformed,
 * or more than a few minutes after the latest block.
 */
export async function GetProviderBreakdown(blockTimestamp?: string): Promise<ProviderBreakdownData[]> {
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

  // Group nodes by provider, skipping nodes without a provider
  const providerGroups = new Map<string, { name: string; nodes: NodeWithDetails[] }>()
  for (const node of userNodes) {
    if (!node.providerId) continue
    const name = node.provider?.name ?? node.providerId
    let group = providerGroups.get(node.providerId)
    if (!group) {
      group = { name, nodes: [] }
      providerGroups.set(node.providerId, group)
    }
    group.nodes.push(node)
  }

  const providerEntries = Array.from(providerGroups.entries())
  const client = getServerApolloClient(graphqlUrl)

  const latestBlockDate = new Date((await getLatestBlock(graphqlUrl)).timestamp)
  const clientBlockDate = parseBlockTimestamp(blockTimestamp)
  const blockDate =
    clientBlockDate && clientBlockDate.getTime() - latestBlockDate.getTime() <= MAX_BLOCK_TIMESTAMP_LEAD_MS
      ? clientBlockDate
      : latestBlockDate
  const currentDate = blockDate.toISOString()
  const last24Hours = new Date(blockDate.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const last48Hours = new Date(blockDate.getTime() - 48 * 60 * 60 * 1000).toISOString()

  const results = await Promise.allSettled(
    providerEntries.map(async ([, group]) => {
      const stakedNodes = group.nodes.filter((n) => n.status === NodeStatus.Staked)
      const supplierAddresses: Array<string> = stakedNodes.map((n) => n.address)
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

      return batchResults.reduce(
        (acc, { data: d }) => ({
          last24h: Number(acc.last24h ?? 0) + Number(d.last24h ?? 0),
          last48h: Number(acc.last48h ?? 0) + Number(d.last48h ?? 0),
        }),
        { last24h: 0, last48h: 0 } as { last24h: number; last48h: number },
      )
    }),
  )

  const allProviders: ProviderBreakdownData[] = providerEntries.map(
    ([identity, group], index) => {
      const result = results[index]
      const data = result?.status === 'fulfilled' ? result.value : null
      const stakedNodes = group.nodes.filter((n) => n.status === NodeStatus.Staked)

      return {
        identity,
        name: group.name,
        suppliers: stakedNodes.length,
        stakedPokt: stakedNodes.reduce(
          (sum, n) => sum + amountToPokt(n.stakeAmount),
          0,
        ),
        rewards24h: amountToPokt(data?.last24h ?? 0),
        rewards48h: amountToPokt(data?.last48h ?? 0),
      }
    },
  )

  // Remove provider entries that have no staked suppliers (provider visibility)
  const providers: ProviderBreakdownData[] = allProviders.filter((p) => p.suppliers > 0)

  providers.sort((a, b) => b.suppliers - a.suppliers)
  return providers
}
