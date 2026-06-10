import {
  ActivityFailure,
  ApplicationFailure,
  proxyActivities,
  TimeoutFailure,
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

function isStartToCloseTimeout(err: unknown): boolean {
  if (err instanceof ActivityFailure && err.cause instanceof TimeoutFailure) {
    return err.cause.timeoutType === 'START_TO_CLOSE'
  }
  return false
}

/**
 * Extracts the owner + operator addresses from a Stake transaction's unsigned payload.
 * Used for the Tier 4 fallback (supplier state check) when TX lookup fails — both are
 * needed so the fallback can confirm the on-chain supplier is actually owned by us
 * rather than someone who staked the same operator address during the verify window.
 */
function extractStakeAddresses(
  transaction: { unsignedPayload?: string | null },
): { operatorAddress?: string; ownerAddress?: string } {
  try {
    if (!transaction.unsignedPayload) return {}
    const payload = JSON.parse(transaction.unsignedPayload)
    const messages = payload?.body?.messages
    if (!Array.isArray(messages)) return {}
    for (const msg of messages) {
      if (
        msg.typeUrl === '/pocket.supplier.MsgStakeSupplier' &&
        typeof msg.value?.operatorAddress === 'string'
      ) {
        return {
          operatorAddress: msg.value.operatorAddress,
          ownerAddress:
            typeof msg.value?.ownerAddress === 'string' ? msg.value.ownerAddress : undefined,
        }
      }
    }
    return {}
  } catch {
    return {}
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
    // Re-sample the height AFTER broadcast: txHeight was captured before
    // executeTransaction, so if the chain advanced during broadcast a wait based on the
    // stale txHeight can no-op and trigger verifyTransaction before the tx is indexed.
    // waitForNextBlock blocks until currentHeight >= arg + 1, so passing the fresh
    // post-broadcast height guarantees we wait for at least one block past it — the
    // indexing margin — regardless of how many blocks broadcast spanned. The verify
    // retry loop covers any remaining lag.
    const heightAfterBroadcast = await getBlockHeight();
    await waitForNextBlock(heightAfterBroadcast);
  }

  const txHash = result?.transactionHash || transaction.hash!;
  const baseHeight = transaction.executionHeight || txHeight;
  const { operatorAddress, ownerAddress } = extractStakeAddresses(transaction);

  let success = false;
  let code = -1;
  let gasUsed = '0';
  let txFoundOnChain = false;
  let supplierFallbackHit = false;
  let verifyErroredUnexpectedly = false;
  let verifyTimedOut = false;

  try {
    // Retries are driven by Temporal's activity retry policy — one attempt per block
    // up to TX_EXPIRATION_BLOCKS. A found tx returns the tuple; a missing tx throws
    // retriable TX_NOT_FOUND until the policy is exhausted.
    [success, code, gasUsed] = await verifyTransaction(txHash, baseHeight);
    txFoundOnChain = true;
  } catch (err) {
    // We only reach here after verifyTransaction exhausted its full retry budget
    // (TX_EXPIRATION_BLOCKS ≈ 30 min), so a transient RPC blip would already have
    // recovered. Whatever the failure reason, attempt the positive-only supplier
    // fallback — a supplier on-chain conclusively confirms the stake regardless of
    // why verify failed. If the fallback is inconclusive we mark Failure (bounded:
    // we never rethrow into an indefinite Pending loop) but record *why* so a real
    // verification error stays triageable instead of being mislabeled a clean
    // "not found".
    // A clean not-found and a start-to-close timeout are both inconclusive (no
    // proof the tx failed); only anything else counts as an unexpected error.
    verifyTimedOut = isStartToCloseTimeout(err);
    verifyErroredUnexpectedly = !isTxNotFoundFailure(err) && !verifyTimedOut;

    // Need both addresses to validate ownership — without the expected owner the
    // supplier fallback can't prove the on-chain supplier is ours, so we skip it
    // and let the tx stay marked Failure rather than risk a false positive.
    if (operatorAddress && ownerAddress) {
      try {
        const supplierExists = await checkSupplierOnChain(operatorAddress, ownerAddress);
        if (supplierExists) {
          success = true;
          code = 0;
          gasUsed = '0';
          supplierFallbackHit = true;
        }
      } catch {
        // supplier check also failed (e.g. RPC still down) — no positive evidence,
        // tx stays marked as Failure (success stays false)
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
  } else if (verifyErroredUnexpectedly) {
    verificationLog = `verification errored (not a clean not-found) after ${TX_EXPIRATION_BLOCKS} retries; marked failure for triage (baseHeight=${baseHeight})`;
  } else if (verifyTimedOut) {
    verificationLog = `verify timed out (inconclusive, treated as not-found) after ${TX_EXPIRATION_BLOCKS} retries (baseHeight=${baseHeight})`;
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
