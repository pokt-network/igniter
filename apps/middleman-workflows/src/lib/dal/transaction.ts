import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import { transactionsTable, Transaction as TransactionModel } from '@igniter/db/middleman/schema'
import { TransactionStatus } from '@igniter/db/middleman/enums'

export default class Transaction {
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

  async getTransaction(transactionId: number) {
    return this.dbClient.db.query.transactionsTable.findFirst({
      where: eq(transactionsTable.id, transactionId),
    });
  }

  async listByStatus(status: TransactionStatus) {
    return this.dbClient.db.query.transactionsTable.findMany({
      where: eq(transactionsTable.status, status)
    });
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
      ));
  }

  /**
   * Atomically move a still-pending, broadcast tx to a terminal status.
   * Returns the updated row iff THIS call performed the transition (affected 1 row),
   * undefined otherwise. The WHERE clause is the concurrency guard: a second caller
   * (overlapping sweep / both paths) sees 0 rows and must NOT run effects.
   * IMPORTANT: callers MUST run downstream effects (node creation, provider notify)
   * BEFORE this CAS — effects are idempotent, but a status flip before effects risks
   * skipping them on retry when the CAS is no longer winnable.
   */
  async claimTerminalTransition(
    transactionId: number,
    status: TransactionStatus.Success | TransactionStatus.Failure,
    fields: { code?: number; consumedFee?: number; verificationHeight?: number; log?: string },
  ): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({ status, ...fields })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
      ))
      .returning();
    return row;
  }

  /**
   * Diagnostics-only write (code/log) that applies ONLY while the row is still pending.
   * The status predicate is the point: an anchored row is visible to the verifier from the
   * moment it is written, so an unguarded update from the broadcaster could overwrite the
   * code/log of a verdict the verifier already reached.
   */
  async recordPendingDiagnostics(
    transactionId: number,
    fields: { code?: number; log?: string },
  ): Promise<void> {
    await this.dbClient.db
      .update(transactionsTable)
      .set(fields)
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
      ));
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
      .where(eq(transactionsTable.id, transactionId));
  }

  async updateTransaction(
    transactionId: number,
    payload: Partial<TransactionModel>
  ) {
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }
    return await this.dbClient.db
      .update(transactionsTable)
      .set(payload)
      .where(eq(transactionsTable.id, transaction.id))
      .returning()
      .then((res) => res[0]);
  }
}
