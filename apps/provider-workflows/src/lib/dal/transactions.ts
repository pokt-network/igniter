import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
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
   * Re-entry guard for remediation: true when a key already has ANY still-pending
   * transaction (with or without a hash — the write-ahead slot also blocks re-entry).
   * Prevents double-staking the same key while its previous stake tx is awaiting
   * verification or while the WAL row is live. Fail-closed: a hash-less row means
   * a broadcast is in flight and we must not start another.
   */
  /**
   * Write-ahead claim: atomically inserts the Pending row for this key BEFORE
   * broadcast. The partial unique index transactions_key_pending_uq makes this the
   * single point of mutual exclusion — a concurrent remediation (other schedule,
   * abandoned child from a previous sweep, activity retry) gets null and MUST skip.
   */
  async claimBroadcastSlot(values: InsertTransaction): Promise<number | null> {
    const [row] = await this.dbClient.db.insert(transactionsTable)
      .values({ ...values, status: TransactionStatus.Pending, hash: null })
      .onConflictDoNothing()
      .returning({ id: transactionsTable.id })
    return row?.id ?? null
  }

  /** Post-broadcast arm: CAS the WAL row with the broadcast facts. If the sweep
   *  expired the row mid-flight (0 rows), re-arm unconditionally by id — the
   *  broadcast demonstrably happened and the verifier must own it. */
  async armBroadcast(id: number, facts: { hash: string; executionHeight: number; timeoutHeight: number | null; code: number | null; message: string | null }): Promise<void> {
    const res = await this.dbClient.db.update(transactionsTable)
      .set({ ...facts, status: TransactionStatus.Pending })
      .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, TransactionStatus.Pending)))
      .returning({ id: transactionsTable.id })
    if (res.length === 0) {
      await this.dbClient.db.update(transactionsTable)
        .set({ ...facts, status: TransactionStatus.Pending })
        .where(eq(transactionsTable.id, id))
    }
  }

  /** Pre-broadcast failure / unknown outcome: release the slot. CAS so a row the
   *  verifier already owns is never clobbered. */
  async failBroadcastSlot(id: number, message: string): Promise<void> {
    await this.dbClient.db.update(transactionsTable)
      .set({ status: TransactionStatus.Failure, message })
      .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, TransactionStatus.Pending), isNull(transactionsTable.hash)))
  }

  /** Sweeper hygiene: a Pending row with no hash older than T means the activity
   *  died between claim and arm (worker crash). T must exceed one full activity
   *  attempt (startToCloseTimeout 390s) — retries skip via the claim, so the
   *  broadcast can only have happened inside the first attempt's window. */
  async expireStaleBroadcasts(olderThanMinutes = 15): Promise<number> {
    const res = await this.dbClient.db.update(transactionsTable)
      .set({ status: TransactionStatus.Failure, message: 'broadcast outcome unknown (stale write-ahead row)' })
      .where(and(
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNull(transactionsTable.hash),
        sql`${transactionsTable.createdAt} < now() - interval '${sql.raw(String(olderThanMinutes))} minutes'`,
      ))
      .returning({ id: transactionsTable.id })
    return res.length
  }

  async hasPendingTx(keyId: number): Promise<boolean> {
    const [row] = await this.dbClient.db
      .select({ id: transactionsTable.id })
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.keyId, keyId),
        eq(transactionsTable.status, TransactionStatus.Pending),
      ))
      .limit(1)
    return row !== undefined
  }
}
