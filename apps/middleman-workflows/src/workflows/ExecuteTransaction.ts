import {
  ApplicationFailure,
  log,
  patched,
  proxyActivities,
} from '@temporalio/workflow'
import { delegatorActivities } from "@/activities";
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import { TX_EXPIRATION_BLOCKS } from '@igniter/tx-verify'

interface TransactionArgs {
  transactionId: number;
}

type Activities = ReturnType<typeof delegatorActivities>
type ProxiedActivities = ReturnType<typeof proxyActivities<Activities>>
type TransactionRow = Awaited<ReturnType<Activities['getTransaction']>>

/**
 * Marks the second command sequence this workflow has emitted. The id names the Temporal-level
 * fact — the order of activities recorded in a run's history changed — rather than the business
 * change that motivated it (#339), because that is what a replaying worker is comparing against.
 *
 * The v1 sequence was:
 *   getTransaction → getBlockHeight → executeTransaction → getTxTimeoutHeight → updateTransaction
 * v2 is:
 *   getTransaction → getBlockHeight → persistBroadcastAnchor → executeTransaction → …
 * plus reordered terminal branches (effects before the status flip) and CAS-guarded writes.
 *
 * WHY THIS EXISTS. Temporal does not resume a workflow where it stopped — it replays the
 * recorded history from the top and checks that the code emits the same commands in the same
 * order. Igniter is upgraded by stopping and restarting the process, and workflow state lives in
 * Temporal's own database, so any ExecuteTransaction open at that moment is replayed by the NEW
 * code against a history written by the OLD code. This rework inserts `persistBroadcastAnchor`
 * before the broadcast, drops `getTxTimeoutHeight`, and reorders the terminal branches — three
 * divergences. Without this gate the replay mismatches, Temporal fails the workflow TASK (not the
 * run) and retries it forever: the run sits in RUNNING permanently, the 10s dispatcher cannot
 * start a replacement (`ALLOW_DUPLICATE_FAILED_ONLY` only allows one when the previous run
 * FAILED), and the transaction is stranded — either never broadcast, or broadcast and on-chain
 * while the row carries no hash for the verifier to find. Silent, and it needs a manual terminate
 * in the Temporal UI to clear.
 *
 * `patched()` returns false when replaying a history recorded before this marker existed, so
 * those runs finish on `legacyFlow` exactly as they would have pre-upgrade, and every new run
 * takes `anchoredFlow`.
 *
 * REMOVAL. An ExecuteTransaction run lives seconds (3 broadcast attempts × 30s at worst), so no
 * pre-upgrade history can still be open a few minutes after deploy. A later release should
 * therefore delete `legacyFlow`, the `getTxTimeoutHeight` activity it is the last caller of, and
 * this marker — the standard sequence being `deprecatePatch()` first if you want to be strict.
 */
const PATCH_COMMAND_SEQUENCE_V2 = 'execute-transaction-command-sequence-v2'

/**
 * Broadcaster. Anchors a pending transaction (hash + heights), broadcasts it, and leaves it
 * `pending` for the VerifyPendingTransactions sweeper to settle against the chain. No
 * verification happens here — that responsibility moved to the verifier so a slow or unreachable
 * RPC can never turn a broadcast into a false failure on this path.
 */
export async function ExecuteTransaction(args: TransactionArgs) {
  const { transactionId } = args;

  const activities = proxyActivities<Activities>({
    startToCloseTimeout: "30s",
    retry: {
      maximumAttempts: 3,
    },
  });

  const transaction = await activities.getTransaction(transactionId);

  // Someone else already settled this row. Return, do NOT throw: a plain Error from workflow code
  // does not fail the RUN — the SDK turns it into an unhandled rejection, which fails the workflow
  // TASK, and the server retries that forever. The run then sits RUNNING permanently and the
  // dispatcher cannot start a replacement (ALLOW_DUPLICATE_FAILED_ONLY needs a FAILED run), so the
  // tx is stranded with no error surfaced anywhere — the wedge noWorkflowError.test.ts documents
  // (that guard only greps for a constructed WorkflowError, so a plain Error slips past it).
  // Anchoring before
  // broadcast widened this: the verifier can settle a row while this workflow is still inside its
  // ~90s broadcast phase, so a retried run routinely finds it terminal.
  if (transaction.status !== TransactionStatus.Pending) {
    log.info('ExecuteTransaction: transaction already settled, nothing to do', { transactionId, status: transaction.status });
    return { ...transaction };
  }

  // A hash means the anchor was written, so the verifier owns this row from here on.
  //
  // Since the anchor is written BEFORE broadcasting, a hash no longer proves the bytes reached a
  // node — only that we committed to sending them. A run that died between the anchor and a
  // successful broadcast therefore returns here without re-sending, and the verifier settles it
  // (Failure once coverage passes timeoutHeight, since the tx never landed). That is a correct
  // verdict reached slowly; re-broadcasting instead would resolve it faster and is safe under the
  // current classification (an in-mempool repeat answers code 19 → dedup-success, a landed one
  // answers code 32 → indeterminate), but it is a behavioural change worth making deliberately
  // rather than as a side effect of this fix.
  if (transaction.hash) {
    log.debug('ExecuteTransaction: anchored already, handing off to verifier', { transactionId, hash: transaction.hash });
    return { ...transaction };
  }

  const txHeight = await activities.getBlockHeight();

  // The gate sits here deliberately: everything above is byte-identical in both versions (same
  // three commands, same order), so a pre-upgrade history replays cleanly up to this point.
  // Everything below changed shape and must be inside the gate.
  return patched(PATCH_COMMAND_SEQUENCE_V2)
    ? anchoredFlow(activities, transaction, txHeight, transactionId)
    : legacyFlow(activities, transaction, txHeight, transactionId);
}

/** Post-#339 flow. See the patch marker above for why the pre-#339 one is still in this file. */
async function anchoredFlow(
  activities: ProxiedActivities,
  transaction: TransactionRow,
  txHeight: number,
  transactionId: number,
) {
  const {
    updateTransaction,
    executeTransaction,
    persistBroadcastAnchor,
    claimBroadcastFailure,
    recordBroadcastDiagnostics,
    notifyProviderOfFailedStakes,
    notifyUserOfFailedTransaction,
  } = activities;

  // No hash and the broadcast window already expired → mark failed immediately.
  if (transaction.executionHeight && txHeight - transaction.executionHeight > TX_EXPIRATION_BLOCKS) {
    log.warn('ExecuteTransaction: expired before broadcast', { transactionId });
    // Effects BEFORE the status flip, per the invariant documented on claimTerminalTransition
    // (lib/dal/transaction.ts): effects are idempotent and a partial run is re-swept, but a
    // status flip first is unrecoverable — the re-entry guard above throws "Transaction is not
    // pending", so a crash in between would strand the provider's addresses forever.
    if (transaction.type === TransactionType.Stake) {
      await notifyProviderOfFailedStakes(transaction.id);
    }
    await notifyUserOfFailedTransaction(transactionId, 'TX expired before broadcast');
    await updateTransaction(transactionId, {
      status: TransactionStatus.Failure,
      log: 'TX expired before broadcast',
    });
    return { ...transaction, status: TransactionStatus.Failure };
  }

  // Anchor the tx BEFORE broadcasting: hash (derived locally from the signed bytes),
  // executionHeight (sampled above, so it can never exceed the first possible inclusion height)
  // and the embedded timeoutHeight. Once written, a crash anywhere below re-enters at the
  // `transaction.hash` guard and hands the tx to the verifier instead of broadcasting twice.
  const hash = await persistBroadcastAnchor(transactionId, txHeight);

  // null = the signed payload cannot even be decoded, so it can never be broadcast or land.
  // Deterministic, and terminal — the alternative is a row the dispatcher retries forever.
  if (!hash) {
    log.error('ExecuteTransaction: signed payload is not broadcastable', { transactionId });
    if (transaction.type === TransactionType.Stake) {
      await notifyProviderOfFailedStakes(transaction.id);
    }
    await notifyUserOfFailedTransaction(transactionId, 'Signed transaction payload is malformed');
    await updateTransaction(transactionId, {
      status: TransactionStatus.Failure,
      log: 'signed payload is not valid hex — nothing could be broadcast',
    });
    return { ...transaction, status: TransactionStatus.Failure };
  }

  const result = await executeTransaction(transaction.id);

  // NOTE ON `result.neverSent`: it is reported (and logged by the activity) but deliberately not
  // acted on. Clearing the anchor to allow a re-broadcast would be destructive — it hides a tx
  // that may be in a mempool from the verifier, which is #339 itself — and it is unnecessary:
  // an unknown outcome keeps the anchor, so the verifier settles the row either way. The flag
  // earns its place as a diagnostic that separates "we never reached the node" from "we reached
  // it and heard nothing back".

  // Only a deterministic CheckTx rejection ON THE FIRST ATTEMPT is proof of failure. A retry
  // re-broadcasts identical bytes, and if the earlier attempt already landed the tx, the node
  // answers about the world that tx created — insufficient funds now that the stake deducted the
  // balance, or a consumed sequence. Those read as rejections but mean "already landed". Only the
  // verifier can tell the difference, so a rejection on a retry is handed to it. See #339.
  if (result.rejected && result.attempt === 1) {
    log.warn('ExecuteTransaction: broadcast rejected by node', { transactionId, hash, code: result.code, message: result.message });
    // CAS FIRST here — the opposite order to the expired branch above, deliberately.
    //
    // That branch runs effects first because its row has no hash, so no other writer can see it
    // and the only risk is losing an effect. This row has been visible to the verifier since the
    // anchor, and the verifier can reach the OPPOSITE verdict: decideVerification returns success
    // on goal-state alone (a sibling tx staked the same operator), creates the node rows and tells
    // the provider those addresses are staked. Releasing them afterwards is a destructive
    // cross-app write contradicting the verdict that stands, and it is NOT recoverable: the
    // provider's markStaked requires state=Delivered, so a release landing first turns the
    // verifier's success effect into a silent no-op and the key can be re-delivered to another
    // delegator. Nothing fires unless this call is the one that terminalized the row.
    const claimed = await claimBroadcastFailure(transactionId, {
      code: result.code,
      log: result.message || 'broadcast rejected',
    });
    if (!claimed) {
      log.info('ExecuteTransaction: verifier settled this row first, standing down', { transactionId });
      return { ...transaction };
    }

    if (transaction.type === TransactionType.Stake) {
      await notifyProviderOfFailedStakes(transaction.id);
    }
    await notifyUserOfFailedTransaction(transactionId, result.message || 'Broadcast rejected by the node');
    return { ...transaction, status: TransactionStatus.Failure, code: result.code };
  }

  if (result.rejected) {
    log.warn('ExecuteTransaction: rejection on a retry — deferring to the verifier', {
      transactionId,
      hash,
      attempt: result.attempt,
      code: result.code,
      message: result.message,
    });
  }

  if (result.success) {
    log.info('ExecuteTransaction: broadcast succeeded', { transactionId, hash, executionHeight: txHeight });
    return { ...transaction, hash, executionHeight: txHeight };
  }

  // Outcome unknown. The anchor is already persisted and the row is still `pending`, so it sits
  // in listPendingWithHash's queue and the verifier settles it against the chain. Record the
  // transport error for triage — without this the reason is lost, and a later verdict would
  // read only the verifier's generic "validity bound covered" text.
  log.warn('ExecuteTransaction: broadcast outcome unknown, handing to verifier', {
    transactionId,
    hash,
    executionHeight: txHeight,
    isTimeout: result.isTimeout,
    code: result.code,
    message: result.message,
  });
  await recordBroadcastDiagnostics(transactionId, {
    code: result.code,
    log: result.message || 'broadcast outcome unknown (awaiting verification)',
  });

  return { ...transaction, hash, executionHeight: txHeight };
}

/**
 * Pre-#339 flow, kept VERBATIM so runs that were open across the upgrade replay to completion.
 * Do not "improve" anything in here — every command and its order must match the histories those
 * runs already recorded. Delete it (with `getTxTimeoutHeight`) once no pre-upgrade run can exist.
 *
 * Note these runs are not stuck with the old bug: activities are never version-pinned, so this
 * path calls the fixed `sendTransaction`, which now always returns a locally derived hash. The
 * `!result.transactionHash` branch below therefore no longer fires on a transport failure — the
 * row gets its hash and the verifier settles it, which is the substance of the #339 fix.
 */
async function legacyFlow(
  activities: ProxiedActivities,
  transaction: TransactionRow,
  txHeight: number,
  transactionId: number,
) {
  const {
    updateTransaction,
    executeTransaction,
    getTxTimeoutHeight,
    notifyProviderOfFailedStakes,
    notifyUserOfFailedTransaction,
  } = activities;

  if (transaction.executionHeight && txHeight - transaction.executionHeight > TX_EXPIRATION_BLOCKS) {
    log.warn('ExecuteTransaction: expired before broadcast', { transactionId });
    await updateTransaction(transactionId, {
      status: TransactionStatus.Failure,
      log: 'TX expired before broadcast',
    });
    if (transaction.type === TransactionType.Stake) {
      await notifyProviderOfFailedStakes(transaction.id);
    }
    await notifyUserOfFailedTransaction(transactionId, 'TX expired before broadcast');
    return { ...transaction, status: TransactionStatus.Failure };
  }

  const result = await executeTransaction(transaction.id);
  if (!result) {
    throw new ApplicationFailure("Transaction execution failed", "fatal_error", true);
  }

  if (!result.transactionHash) {
    log.warn('ExecuteTransaction: broadcast returned no hash', { transactionId, code: result.code, message: result.message });
    await updateTransaction(transactionId, {
      status: TransactionStatus.Failure,
      code: result.code,
      log: result.message || 'unknown error',
    });
    await notifyUserOfFailedTransaction(transactionId, result.message || 'Broadcast returned no transaction hash');
    return { ...transaction, status: TransactionStatus.Failure, code: result.code };
  }

  const timeoutHeight = await getTxTimeoutHeight(transactionId);

  log.info('ExecuteTransaction: broadcast succeeded', { transactionId, hash: result.transactionHash, executionHeight: txHeight });

  await updateTransaction(transactionId, {
    executionHeight: txHeight,
    hash: result.transactionHash,
    timeoutHeight,
  });

  return { ...transaction, hash: result.transactionHash, executionHeight: txHeight };
}
