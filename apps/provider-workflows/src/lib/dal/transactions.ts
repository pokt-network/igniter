import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import { transactionsTable, InsertTransaction, Transaction as TransactionModel } from '@igniter/db/provider/schema'
import { TransactionStatus } from '@igniter/db/provider/enums'
import type { Logger } from '@igniter/logger'

export default class Transactions {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async insert(tx: InsertTransaction): Promise<void> {
    this.logger.debug('insert: Execution Started', { keyAddress: tx.keyAddress, type: tx.type })
    await this.dbClient.db.insert(transactionsTable).values(tx)
    this.logger.debug('insert: Execution Finished', { keyAddress: tx.keyAddress, type: tx.type })
  }

  async getTransaction(transactionId: number) {
    return this.dbClient.db.query.transactionsTable.findFirst({
      where: eq(transactionsTable.id, transactionId),
    })
  }

  /**
   * The verifier's queue: every transaction that has been broadcast (has a hash +
   * execution height) and is still pending verification, EXCLUDING those checked
   * too recently. The backoff grows with `unavailableChecks` (base 30s × the
   * capped count) so a chronically-unverifiable tx is re-checked ever less often
   * instead of being hammered every sweep — bounding RPC load during an outage.
   * `executionHeight` is required so the verifier never scans from a null/zero
   * height (which would mis-compute the expiration window).
   */
  async listPendingWithHash(): Promise<TransactionModel[]> {
    return this.dbClient.db
      .select()
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
        isNotNull(transactionsTable.executionHeight),
        sql`(${transactionsTable.lastVerificationAt} IS NULL OR ${transactionsTable.lastVerificationAt} < now() - (LEAST(${transactionsTable.unavailableChecks}, 20) * interval '30 seconds'))`,
      ))
  }

  /**
   * Atomically move a still-pending, broadcast tx to a terminal status.
   * Returns the updated row iff THIS call performed the transition (affected 1 row),
   * undefined otherwise. The WHERE clause is the concurrency guard: a second caller
   * (overlapping sweep / both paths) sees 0 rows and must NOT run effects.
   */
  async claimTerminalTransition(
    transactionId: number,
    status: TransactionStatus.Success | TransactionStatus.Failure,
    fields: { code?: number; message?: string },
  ): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({ status, ...fields })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
      ))
      .returning()
    return row
  }

  /**
   * Pending-path counter/coverage update (no status change). Drizzle skips
   * `undefined` set fields, so passing `undefined` leaves a column untouched.
   */
  async recordVerificationProgress(
    transactionId: number,
    p: { lastCoveredHeight?: number; incUnavailable?: boolean },
  ): Promise<void> {
    await this.dbClient.db
      .update(transactionsTable)
      .set({
        lastCoveredHeight: p.lastCoveredHeight,
        unavailableChecks: p.incUnavailable
          ? sql`${transactionsTable.unavailableChecks} + 1`
          : sql`GREATEST(${transactionsTable.unavailableChecks} - 1, 0)`,
        lastVerificationAt: new Date(),
      })
      .where(eq(transactionsTable.id, transactionId))
  }

  /**
   * Re-entry guard for remediation: true when a key already has a broadcast,
   * still-pending transaction owned by the verifier. Prevents double-staking
   * the same key while its previous stake tx is awaiting verification.
   */
  async hasPendingTx(keyId: number): Promise<boolean> {
    const [row] = await this.dbClient.db
      .select({ id: transactionsTable.id })
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.keyId, keyId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
      ))
      .limit(1)
    return row !== undefined
  }
}
