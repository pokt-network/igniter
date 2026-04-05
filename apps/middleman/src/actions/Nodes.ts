'use server'

import type { NodeWithDetails } from '@igniter/db/middleman/schema'
import { countAllNodes, getAllNodes, getNode, getNodesByUser, getOwnerAddressesByUser, getProviderCountByUser, getStakedNodesAddress } from '@/lib/dal/nodes'
import { requireAuth, requireAdmin, assertOwnership } from "@/lib/utils/actions";
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { normalizeIdentityToAddress } from '@igniter/commons/crypto'
import { summaryDocument, StakeStatus } from '@igniter/graphql'
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

export async function GetProviderBreakdown(): Promise<ProviderBreakdownData[]> {
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
  const latestBlock = await getLatestBlock(graphqlUrl)
  const client = getServerApolloClient(graphqlUrl)

  const blockDate = new Date(
    latestBlock.timestamp.endsWith('Z')
      ? latestBlock.timestamp
      : latestBlock.timestamp + 'Z',
  )
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
            query: summaryDocument,
            variables: {
              filter: {
                stakeStatus: { equalTo: StakeStatus.Staked },
                id: { in: batch },
                ownerId: { in: ownerAddresses },
              },
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

  const providers: ProviderBreakdownData[] = providerEntries.map(
    ([identity, group], index) => {
      const result = results[index]
      const data = result?.status === 'fulfilled' ? result.value : null

      return {
        identity,
        name: group.name,
        suppliers: group.nodes.length,
        stakedPokt: group.nodes.reduce(
          (sum, n) => sum + amountToPokt(n.stakeAmount),
          0,
        ),
        rewards24h: amountToPokt(data?.last24h ?? 0),
        rewards48h: amountToPokt(data?.last48h ?? 0),
      }
    },
  )

  providers.sort((a, b) => b.suppliers - a.suppliers)
  return providers
}
