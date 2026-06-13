import {
  proxyActivities,
  WorkflowError,
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
    notifyProviderOfFailedStakes,
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
    return { ...transaction };
  }

  const txHeight = await getBlockHeight();

  // No hash and the broadcast window already expired → mark failed immediately.
  if (transaction.executionHeight && txHeight - transaction.executionHeight > TX_EXPIRATION_BLOCKS) {
    await updateTransaction(transactionId, {
      status: TransactionStatus.Failure,
      log: 'TX expired before broadcast',
    });
    if (transaction.type === TransactionType.Stake) {
      await notifyProviderOfFailedStakes(transaction.id);
    }
    return { ...transaction, status: TransactionStatus.Failure };
  }

  const result = await executeTransaction(transaction.id);
  if (!result) {
    throw new WorkflowError("Transaction execution failed");
  }

  if (!result.transactionHash) {
    await updateTransaction(transactionId, {
      status: TransactionStatus.Failure,
      code: result.code,
      log: result.message || 'unknown error',
    });
    return { ...transaction, status: TransactionStatus.Failure, code: result.code };
  }

  // Broadcast succeeded: persist hash + height and hand off to the verifier.
  await updateTransaction(transactionId, {
    executionHeight: txHeight,
    hash: result.transactionHash,
  });

  return { ...transaction, hash: result.transactionHash, executionHeight: txHeight };
}
