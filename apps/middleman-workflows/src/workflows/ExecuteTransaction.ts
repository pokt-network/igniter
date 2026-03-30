import {
  proxyActivities,
  WorkflowError,
} from '@temporalio/workflow'
import { delegatorActivities } from "@/activities";
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import {SendTransactionResult} from "@/lib/blockchain";

const TX_EXPIRATION_BLOCKS = 30

interface TransactionArgs {
  transactionId: number;
}

/**
 * Extracts the operator address from a transaction's unsigned payload.
 * Used for Tier 4 fallback (supplier state check) when TX lookup fails.
 */
function extractOperatorAddress(transaction: { unsignedPayload?: string | null }): string | undefined {
  try {
    if (!transaction.unsignedPayload) return undefined
    const payload = JSON.parse(transaction.unsignedPayload)
    const messages = payload?.body?.messages
    if (!Array.isArray(messages)) return undefined
    for (const msg of messages) {
      if (
        msg.typeUrl === '/pocket.supplier.MsgStakeSupplier' &&
        typeof msg.value?.operatorAddress === 'string'
      ) {
        return msg.value.operatorAddress
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export async function ExecuteTransaction(args: TransactionArgs) {
  const { transactionId } = args;

  const {
    getTransaction,
    updateTransaction,
    executeTransaction,
    getBlockHeight,
    verifyTransaction,
    createNewNodesFromTransaction,
    notifyProviderOfStakedAddresses,
    notifyProviderOfFailedStakes,
    updateUnstakingNodesFromTransaction,
    notifyProviderOfUntakingAddresses,
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

  const txHeight = await getBlockHeight();

  let result: SendTransactionResult | null = null;
  let skipWait = false;

  // If TX has NO hash and is expired, mark as failed immediately
  if (!transaction.hash) {
    if (transaction.executionHeight && txHeight - transaction.executionHeight > TX_EXPIRATION_BLOCKS) {
      await updateTransaction(transactionId, {
        status: TransactionStatus.Failure,
        log: 'TX expired before broadcast',
      });
      if (transaction.type === TransactionType.Stake) {
        await notifyProviderOfFailedStakes(transaction.id);
      }
      return { ...transaction, status: TransactionStatus.Failure, newNodes: [], unstakingNodes: [] };
    }

    result = await executeTransaction(
      transaction.id,
    );

    if(!result) {
      throw new WorkflowError("Transaction execution failed");
    }

    if (!result.transactionHash) {
      await updateTransaction(transactionId, {
        status: TransactionStatus.Failure,
        code: result.code,
        log: result.message || 'unknown error',
      });

      return {
        ...transaction,
        status: TransactionStatus.Failure,
        code: result.code,
        log: result.message || 'unknown error',
      }
    }

    await updateTransaction(transactionId, {
      executionHeight: txHeight,
      hash: result.transactionHash,
    });
  } else if (transaction.executionHeight && txHeight - transaction.executionHeight > TX_EXPIRATION_BLOCKS) {
    // TX has a hash but is expired — skip wait, go straight to verification (will use Tier 4 supplier check)
    skipWait = true;
  }

  const { waitForNextBlock } = proxyActivities<
    ReturnType<typeof delegatorActivities>
  >({
    startToCloseTimeout: "45m",
    heartbeatTimeout: "6m",
    retry: {
      maximumAttempts: 200,
    },
  });

  if (!skipWait) {
    await waitForNextBlock(txHeight);
  }

  const [success, code, gasUsed] = await verifyTransaction(
    result?.transactionHash || transaction.hash!,
    transaction.executionHeight || txHeight,
    extractOperatorAddress(transaction),
  );

  const txStatus = success ? TransactionStatus.Success : TransactionStatus.Failure;

  const verificationHeight = await getBlockHeight();

  await updateTransaction(transactionId, {
    status: txStatus,
    verificationHeight,
    consumedFee: Number(gasUsed || 0),
  });

    if (transaction.type === TransactionType.Stake) {
      if (success) {
        const newNodes = await createNewNodesFromTransaction(transaction.id);
        await notifyProviderOfStakedAddresses(transaction.id);

        return {
          ...transaction,
          status: txStatus,
          hash: result?.transactionHash || transaction.hash,
          txHeight,
          newNodes: newNodes || [],
          unstakingNodes: [],
          code,
        };
      } else {
        await notifyProviderOfFailedStakes(transaction.id);

        return {
          ...transaction,
          status: txStatus,
          hash: result?.transactionHash || transaction.hash,
          txHeight,
          newNodes: [],
          unstakingNodes: [],
          code,
        };
      }
    } else if (transaction.type === TransactionType.Unstake && success) {
      const unstakingNodes = await updateUnstakingNodesFromTransaction(transaction.id)

      await notifyProviderOfUntakingAddresses(transaction.id)

      return {
        ...transaction,
        status: txStatus,
        hash: result?.transactionHash || transaction.hash,
        txHeight,
        newNodes: [],
        unstakingNodes,
        code,
      };
    }

  return {
    ...transaction,
    status: txStatus,
    hash: result?.transactionHash || transaction.hash,
    txHeight,
    newNodes: [],
    unstakingNodes: [],
    code,
  };
}
