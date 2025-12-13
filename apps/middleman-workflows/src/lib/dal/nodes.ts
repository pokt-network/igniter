import { nodesTable, transactionsToNodesTable } from '@igniter/db/middleman/schema'
import type {InsertNode, InsertTransactionsToNodesRelation} from "@igniter/db/middleman/schema";
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import {Node as NodeModel, Provider as ProviderModel} from '@igniter/db/middleman/schema'
import {
  and,
  eq,
  gt,
  lte,
  ne,
  inArray
} from 'drizzle-orm/sql/expressions/conditions'
import { asc } from 'drizzle-orm/sql/expressions/select'
import { NodeStatus } from '@igniter/db/middleman/enums'
import { sql } from 'drizzle-orm/sql/sql'

export type NodesMinMax = { total: number, minId: number, maxId: number }

export default class Node {
  logger: Logger

  dbClient: DBClient<typeof schema>

  /**
   * Constructs a new instance of the class.
   *
   * @param {DBClient<typeof schema>} dbClient - The database client instance used for database operations.
   * @param {Logger} logger - The logger instance used for logging activities in the application.
   */
  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  /**
   * Loads a key associated with the specified address from the database.
   *
   * @param {string} address - The address whose key is to be retrieved.
   * @return {Promise<Key | undefined>} - A promise that resolves to the key if found, or undefined if no key is associated with the address.
   */
  async loadNode(address: string): Promise<NodeModel | undefined> {
    return this.dbClient.db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.address, address))
      .limit(1)
      .then(rows => rows.length ? rows[0] : undefined)
  }

  /**
   * Loads a key associated with the specified address from the database.
   *
   * @param {Array<string>} addresses - The address whose key is to be retrieved.
   * @return {Promise<Key | undefined>} - A promise that resolves to the key if found, or undefined if no key is associated with the address.
   */
  async loadNodes(addresses: Array<string>): Promise<Array<NodeModel & {provider: ProviderModel | null}>> {
    return this.dbClient.db.query.nodesTable.findMany({
      where: inArray(nodesTable.address, addresses),
      with: {
        provider: true
      }
    })
  }

  /**
   * Retrieves the total, minimum, and maximum node IDs from the nodes table.
   *
   * @return {Promise<NodesMinMax>} A promise that resolves to an object containing:
   * - `total`: The total number of nodes.
   * - `minId`: The smallest node ID, or 0 if no nodes exist.
   * - `maxId`: The largest node ID, or 0 if no nodes exist.
   */
  async getNodesMinAndMax(): Promise<NodesMinMax> {
    const rows = await this.dbClient.db
      .select({
        total: sql<number>`count(*)::int`.as('total'),
        minId: sql<number | null>`min(${schema.nodesTable.id})::int`.as('minId'),
        maxId: sql<number | null>`max(${nodesTable.id})::int`.as('maxId'),
      })
      .from(nodesTable)

    if (!rows || rows.length === 0) {
      return { total: 0, minId: 0, maxId: 0 }
    }

    return rows[0] as NodesMinMax
  }

  /**
   * Loads the nodes within the specified range of IDs, applying necessary conditions and ordering.
   *
   * @param {number} afterId - The starting node ID (exclusive). Nodes with an ID greater than this value will be included.
   * @param {number} endId - The ending node ID (inclusive). Nodes with an ID less than or equal to this value will be included.
   * @return {Promise<any>} A promise that resolves with the queried nodes based on the specified conditions.
   */
  async loadNodesInRange(afterId: number, endId: number): Promise<Array<{ id: number; address: string }>> {
    afterId = afterId - 1
    const where = and(
      afterId === null ? gt(nodesTable.id, -2147483648) : gt(nodesTable.id, afterId),
      lte(nodesTable.id, endId),
      ne(nodesTable.status, NodeStatus.Unstaked),
    )

    return this.dbClient.db
      .select({ id: nodesTable.id, address: nodesTable.address })
      .from(nodesTable)
      .where(where)
      .orderBy(asc(nodesTable.id))
  }

  /**
   * Updates the key information for the specified address in the database.
   *
   * @param {string} address - The unique identifier of the key to be updated.
   * @param {Partial<schema.InsertNode>} update - The partial object containing the key properties to be updated.
   * @param {number} [lastUpdatedHeight=-1] - The maximum last updated height to consider for updates. Defaults to -1.
   * @return {Promise<any>} A promise that resolves when the update operation is complete.
   */
  async updateNode(address: string, update: Partial<schema.InsertNode>, lastUpdatedHeight: number = -1): Promise<any> {
    return this.dbClient.db.update(nodesTable)
      .set(update)
      .where(
        and(
          lte(nodesTable.lastUpdatedHeight, lastUpdatedHeight),
          eq(nodesTable.address, address),
        ),
      )
  }

  /**
   * Inserts an array of nodes into the database. If a transaction ID is provided,
   * it creates relationships between the transaction and the inserted nodes.
   *
   * @param {InsertNode[]} nodes - An array of nodes to be inserted into the database.
   * @param {number} [transactionId] - Optional transaction ID to associate with the inserted nodes.
   * @return {Promise<Object[]>} A promise that resolves to an array of objects containing the ID and address of the inserted nodes.
   */
  async insert(nodes: InsertNode[], transactionId?: number) {
    return this.dbClient.db.transaction(async (tx) => {
      const insertedNodes = await tx
        .insert(nodesTable)
        .values(nodes)
        .returning({ id: nodesTable.id, address: nodesTable.address });

      if (transactionId && insertedNodes.length > 0) {
        const relations: InsertTransactionsToNodesRelation[] = insertedNodes.map(node => ({
          transactionId: transactionId,
          nodeId: node.id
        }));

        await tx
          .insert(transactionsToNodesTable)
          .values(relations);
      }

      return insertedNodes;
    });
  }

  /**
   * Updates multiple nodes by their addresses and creates relationships with a transaction.
   * This method updates the specified nodes and associates them with the given transaction
   * in the transactions_to_nodes table.
   *
   * @param {string[]} addresses - An array of node addresses to update.
   * @param {Partial<InsertNode>} update - The partial object containing the node properties to be updated.
   * @param {number} transactionId - The transaction ID to associate with the updated nodes.
   * @return {Promise<string[]>} A promise that resolves to an array of updated node addresses.
   */
  async updateManyNodeAndLinkToTransaction(
    addresses: Array<string>,
    update: Partial<InsertNode>,
    transactionId: number
  ): Promise<Array<string>> {
    return this.dbClient.db.transaction(async (tx) => {
      // Update the nodes
      await tx
        .update(nodesTable)
        .set(update)
        .where(inArray(nodesTable.address, addresses));

      // Get the node IDs for the updated nodes
      const nodes = await tx
        .select({ id: nodesTable.id, address: nodesTable.address })
        .from(nodesTable)
        .where(inArray(nodesTable.address, addresses));

      if (nodes.length > 0) {
        // Create the relationships
        const relations: InsertTransactionsToNodesRelation[] = nodes.map(node => ({
          transactionId: transactionId,
          nodeId: node.id
        }));

        await tx
          .insert(transactionsToNodesTable)
          .values(relations);
      }

      return addresses;
    });
  }
}
