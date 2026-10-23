import {proxyActivities, WorkflowIdReusePolicy, ParentClosePolicy, patched, startChild, ActivityFailure, isCancellation} from "@temporalio/workflow";
import { delegatorActivities } from '@/activities';
import {executeChild, log, ApplicationFailure} from "@temporalio/workflow";
import { TransactionType } from '@igniter/db/middleman/enums'

// @ts-expect-error p-limit is ESM-only; its default export has no CJS types under this build's module resolution
import pLimit from 'p-limit'

export interface ExecutePendingTransactionsArgs {}


const MAX_CONCURRENT_TRANSACTIONS = 10

/**
 * The dispatcher, as of v3. Every tick it looks only at pending rows with no hash (a hashed row is
 * the verifier's) and, for each one, either starts an ExecuteTransaction or gives up on it.
 *
 * - It STARTS children and does not wait for them (ParentClosePolicy.ABANDON). Waiting is what let
 *   one wedged child hold the run and, with the schedule's SKIP overlap, stop dispatch for every
 *   transaction (#369). A child that is still running is skipped (WorkflowExecutionAlreadyStarted);
 *   one that wedges ends at CHILD_EXECUTION_TIMEOUT, which covers all of its retries, and
 *   ALLOW_DUPLICATE_FAILED_ONLY lets a later tick start it again.
 * - Each start of a run for a row counts one attempt, once per run id, and only on ticks where the
 *   RPC answered: an RPC outage makes every run fail before it can anchor, and must not count
 *   against rows that would broadcast fine once it is back.
 * - A row with at least GIVE_UP_MIN_ATTEMPTS attempts over at least GIVE_UP_MIN_AGE_MS keeps failing
 *   for a reason nobody recognised (tx 519 was one). It is failed through a CAS on "pending, no hash",
 *   then the provider (Stake) and the user are notified. That is safe on chain: the anchor is written
 *   by its own CAS before any broadcast, so a row failed here was never sent and never will be.
 *   Effects come after the CAS here, unlike ExecuteTransaction, because only the CAS proves the
 *   give-up happened. Their retries are kept short (GIVE_UP_EFFECTS_OPTIONS): this run holds the
 *   schedule (overlap SKIP) while it waits, and a notification that still fails is logged for a
 *   human rather than stalling dispatch for every other transaction.
 *   With the failure outbox (PATCH_FAILURE_OUTBOX) the CAS also records the owed effects instead,
 *   and no effect runs inline: see below.
 * - With the failure outbox, every tick also starts one TransactionFailureEffects child per row
 *   whose effects are owed or in flight, or whose notice never claimed its fence, before looking at
 *   dispatchable rows (so a tick with nothing to dispatch still drives them). Those starts never
 *   count toward the fatal check, and a failed listing is logged and does not stop dispatch.
 */
export const CHILD_EXECUTION_TIMEOUT = '15m'
export const GIVE_UP_MIN_ATTEMPTS = 5
export const GIVE_UP_MIN_AGE_MS = 60 * 60 * 1000
export const GIVE_UP_LOG = 'never broadcast: ExecuteTransaction kept failing for over an hour'
/** At most ~25s per given-up row, once in its life; see the note on effects above. */
export const GIVE_UP_EFFECTS_OPTIONS = {
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2, initialInterval: "2s" },
} as const

/**
 * Gates the v3 dispatcher. A dispatcher run that started before this deploy replays on
 * legacyDispatch, the previous body, unchanged; every new run takes dispatch().
 * REMOVAL: dispatcher runs last seconds, so legacyDispatch can go one release after this ships.
 */
const PATCH_DISPATCH_V3 = 'execute-pending-dispatch-v3'

/**
 * Gates the failure outbox inside v3: the give-up claims with claimUnbroadcastFailureWithEffects
 * and runs no effects, and each tick starts the TransactionFailureEffects children. Evaluated once
 * per run, first. A v3 run recorded before it replays the give-up with its inline effects.
 * REMOVAL: one release after it ships, like PATCH_DISPATCH_V3.
 */
const PATCH_FAILURE_OUTBOX = 'execute-pending-failure-outbox'

export const FAILURE_EFFECTS_EXECUTION_TIMEOUT = '25h'
/** Above this many owed rows a tick warns: they only pile up while a provider is unreachable. */
export const FAILURE_EFFECTS_WARN_ROWS = 200

type Activities = ReturnType<typeof delegatorActivities>
type Dispatchable = Awaited<ReturnType<Activities['listDispatchableTransactions']>>[number]
type Outcome = 'started' | 'running' | 'given-up' | 'start-failed'

export async function ExecutePendingTransactions(_args?: ExecutePendingTransactionsArgs) {
  if (!patched(PATCH_DISPATCH_V3)) {
    return legacyDispatch();
  }
  const outbox = patched(PATCH_FAILURE_OUTBOX);

  const activities = proxyActivities<Activities>({
    startToCloseTimeout: "30s",
    retry: { maximumAttempts: 3 },
  });
  // Notifications for a row this run has already failed: there is no later tick to redo them.
  const effects = proxyActivities<Pick<Activities, 'getTransaction' | 'notifyProviderOfFailedStakes' | 'notifyUserOfFailedTransaction'>>(GIVE_UP_EFFECTS_OPTIONS);

  if (outbox) {
    await startFailureEffects(activities);
  }

  const rows = await activities.listDispatchableTransactions();
  if (rows.length === 0) {
    log.debug('ExecutePendingTransactions: nothing to dispatch');
    return;
  }

  let rpcHealthy = true;
  try {
    await activities.getBlockHeight();
  } catch (err) {
    rpcHealthy = false;
    log.warn('ExecutePendingTransactions: RPC unreachable; dispatching without counting attempts', { reason: String(err) });
  }

  const limit = pLimit(MAX_CONCURRENT_TRANSACTIONS);
  const outcomes: Outcome[] = await Promise.all(
    rows.map((row) => limit(() => dispatchOne(activities, effects, row, rpcHealthy, outbox))),
  );

  // The systemic signal: not one row could even be started (Temporal or worker trouble).
  if (outcomes.every((o) => o === 'start-failed')) {
    throw new ApplicationFailure("ExecutePendingTransactions: no child workflow could be started", "fatal_error", true);
  }
}

async function dispatchOne(
  activities: ReturnType<typeof proxyActivities<Activities>>,
  effects: ReturnType<typeof proxyActivities<Pick<Activities, 'getTransaction' | 'notifyProviderOfFailedStakes' | 'notifyUserOfFailedTransaction'>>>,
  row: Dispatchable,
  rpcHealthy: boolean,
  outbox: boolean,
): Promise<Outcome> {
  const { id, createdAt, dispatchAttempts, firstAttemptAgeMs } = row;

  if (rpcHealthy && dispatchAttempts >= GIVE_UP_MIN_ATTEMPTS && (firstAttemptAgeMs ?? 0) >= GIVE_UP_MIN_AGE_MS) {
    if (outbox) {
      // The CAS writes the outbox too; a later tick starts TransactionFailureEffects for the row.
      if (await activities.claimUnbroadcastFailureWithEffects(id, GIVE_UP_LOG)) {
        log.error('ExecutePendingTransactions: gave up on a transaction that was never broadcast', { transactionId: id, dispatchAttempts, firstAttemptAgeMs });
      }
      return 'given-up';
    }
    if (await activities.claimUnbroadcastFailure(id, GIVE_UP_LOG)) {
      log.error('ExecutePendingTransactions: gave up on a transaction that was never broadcast', { transactionId: id, dispatchAttempts, firstAttemptAgeMs });
      try {
        const transaction = await effects.getTransaction(id);
        if (transaction.type === TransactionType.Stake) {
          await effects.notifyProviderOfFailedStakes(id);
        }
        await effects.notifyUserOfFailedTransaction(id, 'The transaction could not be broadcast. Please sign it again.');
      } catch (err) {
        log.error('ExecutePendingTransactions: transaction failed but its notifications did not go out; notify by hand', { transactionId: id, reason: String(err) });
      }
    }
    return 'given-up';
  }

  // Same id format as before v3 (createdAt as serialized by the activity), so a child started by
  // the previous dispatcher is recognised as running instead of started twice.
  const workflowId = `ExecuteTransaction-${id}-${createdAt}`;
  let runId: string;
  try {
    const handle = await startChild("ExecuteTransaction", {
      workflowId,
      args: [{ transactionId: id }],
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      parentClosePolicy: ParentClosePolicy.ABANDON,
      workflowExecutionTimeout: CHILD_EXECUTION_TIMEOUT,
      retry: { maximumAttempts: 5 },
    });
    runId = handle.firstExecutionRunId;
  } catch (err) {
    if ((err as Error).name === "WorkflowExecutionAlreadyStartedError") {
      return 'running';
    }
    log.warn('ExecutePendingTransactions: could not start ExecuteTransaction', { transactionId: id, reason: String(err) });
    return 'start-failed';
  }

  if (rpcHealthy) {
    try {
      const attempts = await activities.recordDispatchAttempt(id, runId);
      if (attempts !== null && attempts > 1) {
        log.warn('ExecutePendingTransactions: relaunched a transaction whose previous run did not anchor it', { transactionId: id, attempts, giveUpAfter: { attempts: GIVE_UP_MIN_ATTEMPTS, ageMs: GIVE_UP_MIN_AGE_MS } });
      }
    } catch (err) {
      // Bookkeeping only: the child is running either way.
      log.warn('ExecutePendingTransactions: could not record dispatch attempt', { transactionId: id, reason: String(err) });
    }
  }
  return 'started';
}

/**
 * Starts one TransactionFailureEffects child per row the listing returns (effects owed or in flight,
 * or a notice that never claimed its fence). The row is the guard (its CAS transitions), so
 * ALLOW_DUPLICATE: a finished run may be followed by another, and a run still open is rejected by
 * Temporal and skipped. All starts are issued at once. Start errors are logged and swallowed: they
 * must not fail dispatch, and they never count toward its fatal check. A listing that failed for
 * good (ActivityFailure) is logged and skipped the same way, so dispatch goes on; a cancellation or
 * any other error (a bug here) propagates.
 */
async function startFailureEffects(activities: ReturnType<typeof proxyActivities<Activities>>) {
  let rows: Awaited<ReturnType<Activities['listFailureEffects']>>;
  try {
    rows = await activities.listFailureEffects();
  } catch (err) {
    if (!(err instanceof ActivityFailure) || isCancellation(err)) throw err;
    log.warn('ExecutePendingTransactions: could not list failure effects; dispatching anyway', { reason: String(err), cause: err.cause?.message });
    return;
  }

  const results = await Promise.all(rows.map(async ({ id }) => {
    try {
      await startChild("TransactionFailureEffects", {
        workflowId: `TransactionFailureEffects-${id}`,
        args: [{ transactionId: id }],
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        parentClosePolicy: ParentClosePolicy.ABANDON,
        workflowExecutionTimeout: FAILURE_EFFECTS_EXECUTION_TIMEOUT,
      });
      return 'started' as const;
    } catch (err) {
      if ((err as Error).name === "WorkflowExecutionAlreadyStartedError") {
        return 'already-open' as const;
      }
      log.warn('ExecutePendingTransactions: could not start TransactionFailureEffects', { transactionId: id, reason: String(err) });
      return 'start-failed' as const;
    }
  }));

  const counts = {
    listed: rows.length,
    started: results.filter((r) => r === 'started').length,
    alreadyOpen: results.filter((r) => r === 'already-open').length,
  };
  log.debug('ExecutePendingTransactions: failure effects', counts);
  if (rows.length > FAILURE_EFFECTS_WARN_ROWS) {
    log.warn('ExecutePendingTransactions: failure effects are piling up (is a provider unreachable?)', counts);
  }
}

/** The pre-v3 body, kept verbatim for dispatcher histories recorded before PATCH_DISPATCH_V3. */
async function legacyDispatch() {
  const { listTransactions } =
    proxyActivities<ReturnType<typeof delegatorActivities>>({
      startToCloseTimeout: "30s",
      retry: {
        maximumAttempts: 3,
      },
    });

  const txs = await listTransactions();

  if (txs.length === 0) {
    log.debug('ExecutePendingTransactions: no pending transactions');
    return;
  }

  const limit = pLimit(MAX_CONCURRENT_TRANSACTIONS);

  const childPromises = txs.map(({ id, createdAt }) =>
    limit(() => {
      const workflowId = `ExecuteTransaction-${id}-${createdAt}`;
      return executeChild("ExecuteTransaction", {
        workflowId,
        args: [{ transactionId: id }],
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
        parentClosePolicy: ParentClosePolicy.ABANDON,
        retry: {
          maximumAttempts: 5,
        },
      }).catch((err) => {
        if (err.name === "WorkflowExecutionAlreadyStartedError") {
          log.info(`Workflow with ID=${workflowId} is already running, skipping.`);
        } else {
          throw err;
        }
      });
    })
  );

  const results = await Promise.allSettled(childPromises);

  for (const r of results) {
    if (r.status === "rejected") {
      log.warn("ExecutePendingTransactions: child workflow failed", { reason: String(r.reason) });
    }
  }

  // Match the SupplierStatus pattern: a partial failure is tolerated (one bad tx
  // shouldn't block the rest), but if every scheduled child failed the run is a
  // systemic problem (e.g. RPC/DB down) and must surface as a workflow failure
  // rather than completing green. Guard against the empty-batch case where
  // `every` would vacuously return true.
  const allFailed =
    results.length > 0 && results.every((r) => r.status === "rejected");
  if (allFailed) {
    throw new ApplicationFailure("ExecutePendingTransactions: all child workflows failed", "fatal_error", true);
  }
}
