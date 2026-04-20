import {
  ActivityFailure,
  ApplicationFailure,
  proxyActivities,
  WorkflowError,
} from '@temporalio/workflow'
import { delegatorActivities } from "@/activities";
import { TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import {SendTransactionResult} from "@/lib/blockchain";

const TX_EXPIRATION_BLOCKS = 30
const TX_NOT_FOUND_ERROR_TYPE = 'TX_NOT_FOUND'

interface TransactionArgs {
  transactionId: number;
}

/**
 * Returns true when `err` is the retries-exhausted wrapper around the retriable
 * `TX_NOT_FOUND` ApplicationFailure thrown by the `verifyTransaction` activity.
 * Any other failure (RPC unreachable, deserialization, bugs) returns false and
 * should be rethrown so the workflow fails loudly rather than silently marking
 * the tx as failure on insufficient evidence.
 */
function isTxNotFoundFailure(err: unknown): boolean {
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure) {
    return err.cause.type === TX_NOT_FOUND_ERROR_TYPE
  }
  return false
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
    checkSupplierOnChain,
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

  // verifyTransaction polls the chain on its own retry schedule: one attempt per block
  // (pocket block time ≈ 1 min) up to TX_EXPIRATION_BLOCKS, matching the on-chain
  // mempool expiration window. Throws retriable `TX_NOT_FOUND` until the tx lands.
  const { verifyTransaction } = proxyActivities<ReturnType<typeof delegatorActivities>>({
    startToCloseTimeout: "30s",
    retry: {
      initialInterval: "60s",
      backoffCoefficient: 1,
      maximumAttempts: TX_EXPIRATION_BLOCKS,
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

  const txHash = result?.transactionHash || transaction.hash!;
  const baseHeight = transaction.executionHeight || txHeight;
  const operatorAddress = extractOperatorAddress(transaction);

  let success = false;
  let code = -1;
  let gasUsed = '0';
  let txFoundOnChain = false;
  let supplierFallbackHit = false;

  try {
    // Retries are driven by Temporal's activity retry policy — one attempt per block
    // up to TX_EXPIRATION_BLOCKS. A found tx returns the tuple; a missing tx throws
    // retriable TX_NOT_FOUND until the policy is exhausted.
    [success, code, gasUsed] = await verifyTransaction(txHash, baseHeight);
    txFoundOnChain = true;
  } catch (err) {
    // Only fall through to Tier 4 when retries were exhausted specifically with
    // TX_NOT_FOUND. Any other failure (RPC unreachable, bug, unexpected shape) is
    // rethrown so the workflow fails and the tx stays Pending for human triage —
    // avoids false "failure" marks when we lack evidence either way.
    if (!isTxNotFoundFailure(err)) {
      throw err;
    }

    // Retries exhausted. Tier 4: check supplier state directly. Only a positive result
    // (supplier on-chain) is conclusive; a missing supplier keeps the tx marked failed.
    if (operatorAddress) {
      const supplierExists = await checkSupplierOnChain(operatorAddress);
      if (supplierExists) {
        success = true;
        code = 0;
        gasUsed = '0';
        supplierFallbackHit = true;
      }
    }
  }

  const txStatus = success ? TransactionStatus.Success : TransactionStatus.Failure;
  const verificationHeight = await getBlockHeight();

  let verificationLog: string | undefined;
  if (txFoundOnChain) {
    if (code !== 0) {
      verificationLog = `verification failed with code ${code}`;
    }
  } else if (supplierFallbackHit) {
    verificationLog = 'verified via supplier state fallback (tx hash not found)';
  } else {
    verificationLog = `tx not found on-chain after ${TX_EXPIRATION_BLOCKS} retries (baseHeight=${baseHeight})`;
  }

  await updateTransaction(transactionId, {
    status: txStatus,
    verificationHeight,
    consumedFee: Number(gasUsed || 0),
    code,
    log: verificationLog,
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
