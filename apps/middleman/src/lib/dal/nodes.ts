import "server-only";
import { getDb } from "@/db";
import { and, count, countDistinct, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  nodesTable,
  NodeWithDetails,
} from '@igniter/db/middleman/schema'

export async function getNodesByUser(userIdentity: string) {
  return getDb().query.nodesTable.findMany({
    where: eq(nodesTable.createdBy, userIdentity),
    with: {
      provider: true,
      transactionsToNodes: {
        with: {
          transaction: true,
        },
        limit: 10,
        // here we can't order directly by cratedAt of transactionsToNodes because findMany doesn't support orderBy on relations
        orderBy: (t) => [desc(t.transactionId)]
      },
    },
  });
}

export async function getNode(address: string): Promise<NodeWithDetails | undefined> {
  return getDb().query.nodesTable.findFirst({
    where: eq(nodesTable.address, address),
    with: {
      provider: true,
      transactionsToNodes: {
        with: {
          transaction: true,
        },
        limit: 10,
        // here we can't order directly by cratedAt of transactionsToNodes because findMany doesn't support orderBy on relations
        orderBy: (t) => [desc(t.transactionId)]
      },
    },
  });
}

export async function getOwnerAddressesByUser(userIdentity: string) {
  const nodes = await getDb()
    .selectDistinct({ ownerAddress: nodesTable.ownerAddress })
    .from(nodesTable)
    .where(eq(nodesTable.createdBy, userIdentity));

  return nodes.map((row) => row.ownerAddress);
}

// TODO: filter for staked nodes only when we handle this state
export async function getStakedNodesAddress() {
  return await getDb().query.nodesTable.findMany({
    columns: {
      address: true,
    }
  }).then((nodes) => nodes.map((node) => node.address));
}

export async function getNodeAddressesByOwnerAndProvider(
  ownerAddress: string,
  providerIdentity: string,
  userIdentity: string,
): Promise<string[]> {
  return getDb()
    .query.nodesTable.findMany({
      columns: { address: true },
      where: and(
        eq(nodesTable.ownerAddress, ownerAddress),
        eq(nodesTable.providerId, providerIdentity),
        eq(nodesTable.createdBy, userIdentity),
      ),
    })
    .then((nodes) => nodes.map((n) => n.address))
}

export async function getExistingNodes(addresses: Array<string>, userIdentity: string) {
  return await getDb().query.nodesTable.findMany({
    columns: {
      address: true,
    },
    where: and(
      eq(nodesTable.createdBy, userIdentity),
      inArray(nodesTable.address, addresses)
    )
  }).then((nodes) => nodes.map((node) => node.address));
}

export async function getProviderCountByUser(userIdentity: string): Promise<number> {
  const result = await getDb()
    .select({ count: countDistinct(nodesTable.providerId) })
    .from(nodesTable)
    .where(eq(nodesTable.createdBy, userIdentity))

  return result[0]?.count ?? 0
}

export async function getAllNodes(): Promise<NodeWithDetails[]> {
  return getDb().query.nodesTable.findMany({
    with: {
      provider: true,
      transactionsToNodes: {
        with: {
          transaction: true,
        },
        limit: 1,
        orderBy: (t) => [desc(t.transactionId)]
      },
    },
    orderBy: [desc(nodesTable.updatedAt)],
  })
}

export async function countAllNodes(): Promise<number> {
  const [{ value }] = await getDb().select({ value: count() }).from(nodesTable)
  return value
}

export async function getAllNodesSummary(): Promise<{ count: number; totalStaked: number }> {
  const result = await getDb()
    .select({
      count: count(),
      totalStaked: sql<string>`coalesce(sum("stakeAmount"::numeric), 0)`,
    })
    .from(nodesTable)

  return {
    count: result[0]?.count ?? 0,
    totalStaked: Number(result[0]?.totalStaked ?? 0),
  }
}
