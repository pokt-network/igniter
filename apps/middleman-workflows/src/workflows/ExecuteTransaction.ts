import {
  log,
  proxyActivities,
  ApplicationFailure,
} from '@temporalio/workflow'
import { delegatorActivities } from "@/activities";
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import { TX_EXPIRATION_BLOCKS } from '@igniter/tx-verify'

interface TransactionArgs {
  transactionId: number;
}

/**
 * Broadcaster. Signs + broadcasts a pending transaction, persists its hash and
 * execution height, then leaves it `pending` (now with a hash) for the
 * VerifyPendingTransactions sweeper to verify. No verification happens here —
 * that responsibility moved to the verifier so a slow/down RPC can never turn a
 * broadcast into a false failure on this path.
 */
export async function ExecuteTransaction(args: TransactionArgs) {
  const { transactionId } = args;

  const {
    getTransaction,
    updateTransaction,
    executeTransaction,
    getBlockHeight,
    getTxTimeoutHeight,
    notifyProviderOfFailedStakes,
    notifyUserOfFailedTransaction,
  } = proxyActivities<ReturnType<typeof delegatorActivities>>({
    startToCloseTimeout: "30s",
    retry: {
      maximumAttempts: 3,
    },
  });

  const transaction = await getTransaction(transactionId);

  if (transaction.status !== TransactionStatus.Pending) {
    throw new Error("Transaction is not pending");
  }

  // Already broadcast (has a hash) → the verifier owns it; nothing to do here.
  if (transaction.hash) {
    log.debug('ExecuteTransaction: already broadcast, handing off to verifier', { transactionId, hash: transaction.hash });
    return { ...transaction };
  }

  const txHeight = await getBlockHeight();

  // No hash and the broadcast window already expired → mark failed immediately.
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

  // Broadcast succeeded: parse timeoutHeight from the signed payload (embedded at signing
  // by KeplrWalletConnection; null for external-wallet txs that omit it).
  const timeoutHeight = await getTxTimeoutHeight(transactionId);

  log.info('ExecuteTransaction: broadcast succeeded', { transactionId, hash: result.transactionHash, executionHeight: txHeight });

  // Persist hash + height + timeoutHeight and hand off to the verifier.
  // executionHeight was sampled BEFORE broadcast (line ~47) — this must not move after
  // broadcast or the anchor would be ≥ the first possible inclusion height.
  await updateTransaction(transactionId, {
    executionHeight: txHeight,
    hash: result.transactionHash,
    timeoutHeight,
  });

  return { ...transaction, hash: result.transactionHash, executionHeight: txHeight };
}
