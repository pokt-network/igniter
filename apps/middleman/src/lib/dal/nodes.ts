import "server-only";
import { getDb } from "@/db";
import { and, countDistinct, desc, eq, inArray, sql } from 'drizzle-orm'
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
  const result = await getDb().execute(
    sql`
    SELECT DISTINCT ${nodesTable.ownerAddress}
    FROM ${nodesTable}
    WHERE ${nodesTable.createdBy} = ${userIdentity}
  `
  );

  return result.rows.map((row) => row.ownerAddress as string);
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
