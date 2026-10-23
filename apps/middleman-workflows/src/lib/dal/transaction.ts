import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import { transactionsTable, Transaction as TransactionModel, FailureEffectsState } from '@igniter/db/middleman/schema'
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
   * The dispatcher's queue: pending rows with no hash. A hashed row was anchored, so the verifier
   * owns it and ExecuteTransaction would only hand it back; listing it cost a child start per tick.
   * Only the fields the dispatcher needs, never the payloads. `firstAttemptAgeMs` is measured by
   * the database clock (null before the first counted attempt).
   *
   * Ordered by attempts first, then id: a row never tried yet comes before rows that already have
   * a child in flight or failing, so `limit` stuck rows cannot hold a new transaction back until
   * they are given up (an hour or more). Rows that keep failing still gain an attempt per tick and
   * are listed again once the fresher rows have left the queue.
   */
  async listDispatchable(limit: number): Promise<Array<{
    id: number
    createdAt: Date | null
    dispatchAttempts: number
    firstAttemptAgeMs: number | null
  }>> {
    return this.dbClient.db
      .select({
        id: transactionsTable.id,
        createdAt: transactionsTable.createdAt,
        dispatchAttempts: transactionsTable.dispatchAttempts,
        firstAttemptAgeMs: sql<number | null>`(extract(epoch from (now() - ${transactionsTable.firstDispatchAttemptAt})) * 1000)::float8`,
      })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.status, TransactionStatus.Pending), isNull(transactionsTable.hash)))
      .orderBy(transactionsTable.dispatchAttempts, transactionsTable.id)
      .limit(limit);
  }

  /**
   * Counts one dispatch attempt for a pending, unanchored row, at most once per ExecuteTransaction
   * run: an activity retry or a second dispatcher reporting the same run id does not count twice.
   * Returns the attempt count after the call, or undefined when the row is no longer dispatchable.
   */
  async recordDispatchAttempt(transactionId: number, runId: string): Promise<number | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({
        dispatchAttempts: sql`${transactionsTable.dispatchAttempts} + CASE WHEN ${transactionsTable.lastDispatchRunId} IS DISTINCT FROM ${runId} THEN 1 ELSE 0 END`,
        firstDispatchAttemptAt: sql`COALESCE(${transactionsTable.firstDispatchAttemptAt}, now())`,
        lastDispatchRunId: runId,
      })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNull(transactionsTable.hash),
      ))
      .returning({ dispatchAttempts: transactionsTable.dispatchAttempts });
    return row?.dispatchAttempts;
  }

  /**
   * Fails a pending row that was never anchored. Since the anchor is written (by CAS) before any
   * broadcast, `hash IS NULL` here proves no bytes were sent, and the anchor CAS guarantees none
   * will be after this wins. Returns the row iff this call made the transition.
   */
  async claimUnbroadcastFailure(transactionId: number, log: string): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({ status: TransactionStatus.Failure, log })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNull(transactionsTable.hash),
      ))
      .returning();
    return row;
  }

  /**
   * Writes the broadcast anchor (hash + heights) only while the row is pending and unanchored, in
   * one statement. Returns the row iff this call wrote it; undefined means another writer (the
   * dispatcher giving up on the row, or a concurrent run) got there first.
   */
  async claimBroadcastAnchor(
    transactionId: number,
    fields: { hash: string; executionHeight: number; timeoutHeight: number | null },
  ): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set(fields)
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNull(transactionsTable.hash),
      ))
      .returning();
    return row;
  }

  /**
   * claimUnbroadcastFailure plus the failure-effects outbox, in the same statement: whoever wins
   * this CAS has also recorded that a release (every staking supplier: addresses left NULL) and a
   * notice are owed. A caller that loses the ack of a committed CAS gets undefined on its retry,
   * but the outbox is already `pending`, so nothing is lost and nothing runs twice.
   */
  async claimUnbroadcastFailureWithEffects(transactionId: number, log: string): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({ status: TransactionStatus.Failure, log, failureEffects: 'pending' })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNull(transactionsTable.hash),
      ))
      .returning();
    return row;
  }

  /**
   * Fails a pending, anchored row (rejected on broadcast) and writes the outbox in the same
   * statement. Same predicate as claimTerminalTransition, but a separate statement on purpose:
   * the success path shares claimTerminalTransition and must never write the outbox. Returns the
   * row iff this call made the transition; the verifier's own failure CAS on the same row then
   * finds it terminal, so the release is owed exactly once.
   */
  async claimBroadcastFailureWithEffects(
    transactionId: number,
    fields: { code?: number; log?: string },
  ): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({ status: TransactionStatus.Failure, ...fields, failureEffects: 'pending' })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
      ))
      .returning();
    return row;
  }

  /**
   * The verifier's failure CAS for an apply-failure Stake verdict, with the outbox and the exact
   * operators to release (the verdict's failedOperators). The array is stored as given: `[]` means
   * release nothing and is never coerced to NULL, which would mean "every staking supplier".
   * Returns the row iff this call made the transition.
   */
  async claimVerifierFailureWithEffects(
    transactionId: number,
    fields: { code?: number; consumedFee?: number; verificationHeight?: number; log?: string },
    releaseAddresses: string[],
  ): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({
        status: TransactionStatus.Failure,
        ...fields,
        failureEffects: 'pending',
        failureReleaseAddresses: releaseAddresses,
      })
      .where(and(
        eq(transactionsTable.id, transactionId),
        eq(transactionsTable.status, TransactionStatus.Pending),
        isNotNull(transactionsTable.hash),
      ))
      .returning();
    return row;
  }

  /**
   * Rows the dispatcher starts one TransactionFailureEffects child for: a release still owed or in
   * flight (`pending`, `releasing`), or any outbox row whose notice never claimed its fence
   * (`failureNotifiedAt` NULL), so a notice that failed in an earlier run is retried by a later one;
   * that run's release step then finds `done` / `manual` and does nothing. One statement. No limit:
   * rows only accumulate while a provider is down or while a notice keeps failing before it claims
   * its fence (each such row returns on every tick until its notice is sent).
   */
  async listFailureEffects(): Promise<Array<{ id: number; failureEffects: FailureEffectsState }>> {
    const rows = await this.dbClient.db
      .select({ id: transactionsTable.id, failureEffects: transactionsTable.failureEffects })
      .from(transactionsTable)
      .where(or(
        inArray(transactionsTable.failureEffects, ['pending', 'releasing']),
        and(isNotNull(transactionsTable.failureEffects), isNull(transactionsTable.failureNotifiedAt)),
      ))
      .orderBy(transactionsTable.id);
    return rows as Array<{ id: number; failureEffects: FailureEffectsState }>;
  }

  /**
   * Entry step of a release, one statement for the whole entry table:
   * - `pending` → `releasing`, returns `proceed`: this caller, and only this one, may POST.
   * - `releasing` → `manual`, returns `was-releasing`: an earlier attempt or run may have POSTed
   *   and we cannot know whether the provider applied it; a second POST could free a key already
   *   re-delivered to another stake, so a person decides.
   * - `done`, `manual` or NULL: no row matches, returns `nothing`.
   * The new value tells the two transitions apart. Two concurrent callers on a `pending` row:
   * the second waits on the row lock, re-reads `releasing` and moves it to `manual`, so at most
   * one POST is ever allowed.
   */
  async beginRelease(transactionId: number): Promise<'proceed' | 'was-releasing' | 'nothing'> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({
        failureEffects: sql`CASE WHEN ${transactionsTable.failureEffects} = 'pending' THEN 'releasing' ELSE 'manual' END`,
      })
      .where(and(
        eq(transactionsTable.id, transactionId),
        inArray(transactionsTable.failureEffects, ['pending', 'releasing']),
      ))
      .returning({ failureEffects: transactionsTable.failureEffects });
    if (!row) return 'nothing';
    return row.failureEffects === 'releasing' ? 'proceed' : 'was-releasing';
  }

  /** CAS on the outbox state; true iff this call moved the row from one of `from` to `to`. */
  private async moveFailureEffects(
    transactionId: number,
    from: FailureEffectsState[],
    to: FailureEffectsState,
  ): Promise<boolean> {
    const rows = await this.dbClient.db
      .update(transactionsTable)
      .set({ failureEffects: to })
      .where(and(
        eq(transactionsTable.id, transactionId),
        inArray(transactionsTable.failureEffects, from),
      ))
      .returning({ id: transactionsTable.id });
    return rows.length === 1;
  }

  /**
   * `releasing` → `pending`: the POST provably never left (connection refused, DNS, TLS), so the
   * next attempt may send it. Only for definite not-sent outcomes; anything ambiguous is manual.
   */
  async releaseNotSent(transactionId: number): Promise<boolean> {
    return this.moveFailureEffects(transactionId, ['releasing'], 'pending');
  }

  /** `releasing` → `done`: the provider answered 200. */
  async releaseDone(transactionId: number): Promise<boolean> {
    return this.moveFailureEffects(transactionId, ['releasing'], 'done');
  }

  /** `releasing` → `manual`: the POST may have been applied (error status, socket error, timeout). */
  async releaseManual(transactionId: number): Promise<boolean> {
    return this.moveFailureEffects(transactionId, ['releasing'], 'manual');
  }

  /**
   * (`pending` | `releasing`) → `done` without a POST: nothing to release (not a Stake, no provider,
   * empty list), so no attempt could ever have POSTed, not even one that left the row `releasing`.
   */
  async noReleaseOwed(transactionId: number): Promise<boolean> {
    return this.moveFailureEffects(transactionId, ['pending', 'releasing'], 'done');
  }

  /**
   * (`pending` | `releasing`) → `manual` once the release activity has run out of time. Returns
   * false, without throwing, when another attempt already moved the row on.
   */
  async effectsExhausted(transactionId: number): Promise<boolean> {
    return this.moveFailureEffects(transactionId, ['pending', 'releasing'], 'manual');
  }

  /**
   * The notify fence: sets failureNotifiedAt only while it is NULL, on a row that owes failure
   * effects. Returns the row iff THIS call won, so the owner is notified at most once whatever
   * restarts, stale listings or `manual` → `pending` resets happen; the caller sends only on a
   * win. A crash (or a lost ack) between the fence and the send loses that notice, by design.
   */
  async claimNotify(transactionId: number): Promise<TransactionModel | undefined> {
    const [row] = await this.dbClient.db
      .update(transactionsTable)
      .set({ failureNotifiedAt: sql`now()` })
      .where(and(
        eq(transactionsTable.id, transactionId),
        isNotNull(transactionsTable.failureEffects),
        isNull(transactionsTable.failureNotifiedAt),
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
