import {
  importSupplierAttemptsTable,
  ImportSupplierAttempt,
  nodesTable,
  InsertNode,
} from '@igniter/db/middleman/schema'
import {
  ImportAttemptStatus,
  NodeStatus,
} from '@igniter/db/middleman/enums'
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import { and, eq } from 'drizzle-orm/sql/expressions/conditions'
import { sql } from 'drizzle-orm'

export default class ImportSupplierAttempts {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  /**
   * Lists all import attempts with 'submitted' status that haven't completed.
   * Used by the recovery workflow to check if imports completed on the provider side.
   *
   * @returns Array of submitted but not completed attempts
   */
  async listPendingSubmitted(): Promise<ImportSupplierAttempt[]> {
    return this.dbClient.db.query.importSupplierAttemptsTable.findMany({
      where: eq(importSupplierAttemptsTable.status, ImportAttemptStatus.Submitted),
    })
  }

  /**
   * Gets an attempt by its ID.
   *
   * @param id - The attempt ID
   * @returns The attempt or undefined
   */
  async getById(id: number): Promise<ImportSupplierAttempt | undefined> {
    return this.dbClient.db.query.importSupplierAttemptsTable.findFirst({
      where: eq(importSupplierAttemptsTable.id, id),
    })
  }

  /**
   * Marks an attempt as completed with the imported supplier addresses.
   *
   * @param id - The attempt ID
   * @param importedSupplierAddresses - Array of imported supplier addresses
   */
  async markCompleted(
    id: number,
    importedSupplierAddresses: string[],
  ): Promise<ImportSupplierAttempt | undefined> {
    // CAS: only a still-submitted attempt transitions to completed, and only the
    // winner gets the row back. A Temporal retry re-runs the whole activity, but
    // the attempt is already terminal by then → no row → no duplicate dispatch.
    const [row] = await this.dbClient.db
      .update(importSupplierAttemptsTable)
      .set({
        status: ImportAttemptStatus.Completed,
        importedSupplierAddresses,
        completedAt: new Date(),
      })
      .where(and(
        eq(importSupplierAttemptsTable.id, id),
        eq(importSupplierAttemptsTable.status, ImportAttemptStatus.Submitted),
      ))
      .returning()
    return row
  }

  /**
   * Marks an attempt as failed with an error message.
   *
   * @param id - The attempt ID
   * @param errorMessage - The error message
   */
  async markFailed(id: number, errorMessage: string): Promise<ImportSupplierAttempt | undefined> {
    // CAS (see markCompleted): only the submitted→failed winner gets the row back,
    // so a retried activity can't re-dispatch the failure notification.
    const [row] = await this.dbClient.db
      .update(importSupplierAttemptsTable)
      .set({
        status: ImportAttemptStatus.Failed,
        errorMessage,
        completedAt: new Date(),
      })
      .where(and(
        eq(importSupplierAttemptsTable.id, id),
        eq(importSupplierAttemptsTable.status, ImportAttemptStatus.Submitted),
      ))
      .returning()
    return row
  }

  /**
   * Saves imported suppliers as nodes.
   *
   * @param attempt - The import attempt
   * @param addresses - Array of supplier addresses to save
   * @param providerIdentity - The provider's identity string
   */
  async saveImportedSuppliers(
    attempt: ImportSupplierAttempt,
    addresses: string[],
    providerIdentity: string,
  ): Promise<void> {
    if (addresses.length === 0) return

    const nodesToInsert: InsertNode[] = addresses.map((address) => ({
      address,
      ownerAddress: attempt.ownerAddress,
      status: NodeStatus.Staked,
      stakeAmount: '0', // Will be updated by SupplierStatus workflow
      providerId: providerIdentity,
      balance: BigInt(0),
      createdBy: attempt.userIdentity,
    }))

    // Use upsert to handle potential duplicates. The nodes.address unique
    // constraint means a bare onConflictDoNothing() would silently drop
    // same-address re-imports, so update the mutable fields instead.
    await this.dbClient.db
      .insert(nodesTable)
      .values(nodesToInsert)
      .onConflictDoUpdate({
        target: nodesTable.address,
        set: {
          // Only the field the import actually KNOWS. status/stakeAmount are
          // chain-sync-owned placeholders in this payload — clobbering them resets
          // a synced row to Staked/'0' (permanent for suppliers gone from chain).
          ownerAddress: sql`excluded."ownerAddress"`,
          updatedAt: new Date(),
        },
      })
  }
}
