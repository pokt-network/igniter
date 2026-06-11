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
   * The verifier's queue: every transaction that has been broadcast (has a hash)
   * but is still pending verification.
   */
  async listPendingWithHash(): Promise<TransactionModel[]> {
    return this.dbClient.db
      .select()
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
      ));
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
   * Pending-path counter/coverage update (no status change). Drizzle skips
   * `undefined` set fields, so passing `undefined` leaves a column untouched.
   */
  async recordVerificationProgress(
    transactionId: number,
    p: { lastCoveredHeight?: number; incTx?: boolean; incSupplier?: boolean; incUnavailable?: boolean },
  ): Promise<void> {
    await this.dbClient.db
      .update(transactionsTable)
      .set({
        lastCoveredHeight: p.lastCoveredHeight,
        txVerificationAttempts: p.incTx ? sql`${transactionsTable.txVerificationAttempts} + 1` : undefined,
        supplierVerificationAttempts: p.incSupplier ? sql`${transactionsTable.supplierVerificationAttempts} + 1` : undefined,
        unavailableChecks: p.incUnavailable ? sql`${transactionsTable.unavailableChecks} + 1` : undefined,
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
