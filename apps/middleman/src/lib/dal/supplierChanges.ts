import "server-only";
import { getDb } from "@/db";
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  nodesTable,
  providersTable,
  supplierChangesTable,
} from '@igniter/db/middleman/schema'

// The ids of the nodes the user owns, to scope the node-keyed queries below to them.
function nodesOwnedBy(userIdentity: string) {
  return getDb()
    .select({ id: nodesTable.id })
    .from(nodesTable)
    .where(eq(nodesTable.createdBy, userIdentity))
}

export async function getChangesByNodeId(nodeId: number, userIdentity: string, limit = 20) {
  return getDb().query.supplierChangesTable.findMany({
    where: and(
      eq(supplierChangesTable.nodeId, nodeId),
      inArray(supplierChangesTable.nodeId, nodesOwnedBy(userIdentity)),
    ),
    orderBy: [desc(supplierChangesTable.createdAt)],
    limit,
  })
}

export async function getRecentChangesByUser(
  userIdentity: string,
  page = 1,
  pageSize = 10,
) {
  const offset = (page - 1) * pageSize

  // Step 1: Get paginated distinct batch IDs ordered by most recent
  const [batchPage, [countResult]] = await Promise.all([
    getDb()
      .selectDistinct({
        batchId: supplierChangesTable.batchId,
        latestCreatedAt: sql<Date>`max(${supplierChangesTable.createdAt})`.as('latest_created_at'),
      })
      .from(supplierChangesTable)
      .innerJoin(nodesTable, eq(supplierChangesTable.nodeId, nodesTable.id))
      .where(eq(nodesTable.createdBy, userIdentity))
      .groupBy(supplierChangesTable.batchId)
      .orderBy(sql`max(${supplierChangesTable.createdAt}) desc`)
      .limit(pageSize)
      .offset(offset),
    getDb()
      .select({
        total: sql<number>`count(distinct ${supplierChangesTable.batchId})`.as('total'),
      })
      .from(supplierChangesTable)
      .innerJoin(nodesTable, eq(supplierChangesTable.nodeId, nodesTable.id))
      .where(eq(nodesTable.createdBy, userIdentity)),
  ])

  const batchIds = batchPage.map((b) => b.batchId)
  const totalBatches = countResult?.total ?? 0

  if (batchIds.length === 0) {
    return { rows: [], total: 0, page, pageSize, totalPages: 0 }
  }

  // Step 2: Fetch all rows for those batch IDs
  const rows = await getDb()
    .select({
      id: supplierChangesTable.id,
      nodeId: supplierChangesTable.nodeId,
      changeType: supplierChangesTable.changeType,
      serviceId: supplierChangesTable.serviceId,
      description: supplierChangesTable.description,
      previousValue: supplierChangesTable.previousValue,
      newValue: supplierChangesTable.newValue,
      batchId: supplierChangesTable.batchId,
      createdAt: supplierChangesTable.createdAt,
      acknowledgedAt: supplierChangesTable.acknowledgedAt,
      nodeAddress: nodesTable.address,
      providerId: nodesTable.providerId,
      providerName: providersTable.name,
    })
    .from(supplierChangesTable)
    .innerJoin(nodesTable, eq(supplierChangesTable.nodeId, nodesTable.id))
    .leftJoin(providersTable, eq(nodesTable.providerId, providersTable.identity))
    .where(
      and(
        eq(nodesTable.createdBy, userIdentity),
        inArray(supplierChangesTable.batchId, batchIds),
      ),
    )
    .orderBy(desc(supplierChangesTable.createdAt))

  return {
    rows,
    total: totalBatches,
    page,
    pageSize,
    totalPages: Math.ceil(totalBatches / pageSize),
  }
}

export async function acknowledgeChanges(changeIds: number[], userIdentity: string) {
  if (changeIds.length === 0) return
  await getDb()
    .update(supplierChangesTable)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        inArray(supplierChangesTable.id, changeIds),
        inArray(supplierChangesTable.nodeId, nodesOwnedBy(userIdentity)),
      ),
    )
}

export async function acknowledgeAllByNode(nodeId: number, userIdentity: string) {
  await getDb()
    .update(supplierChangesTable)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(supplierChangesTable.nodeId, nodeId),
        inArray(supplierChangesTable.nodeId, nodesOwnedBy(userIdentity)),
        isNull(supplierChangesTable.acknowledgedAt),
      ),
    )
}
