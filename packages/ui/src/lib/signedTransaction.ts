import type { SignedTransaction } from "./models";

/**
 * Refuses a "successful" signature that carries no transaction. Two callers, one rule:
 * - the wallet context's signTransaction, for every adapter. Some answer with empty payloads:
 *   Soothe has returned a body with an empty transactionHex (tx 519 on mainnet), and the Morse
 *   adapter and the default stub always return ''. Failing there fails the dialog's signature
 *   step, which lets the user retry at no cost.
 * - the stake/unstake server actions, before inserting, because the request comes from the client.
 *
 * Payloads are untyped at runtime (wallet responses, request bodies), so non-strings are rejected
 * rather than trimmed.
 */
export function assertSignedTransaction(transaction: SignedTransaction): SignedTransaction {
  const { signedPayload, unsignedPayload } = transaction as { signedPayload?: unknown; unsignedPayload?: unknown };

  if (typeof signedPayload !== "string" || !signedPayload.trim()) {
    throw new Error("The wallet returned no signed transaction. Please sign again.");
  }
  if (typeof unsignedPayload !== "string" || !unsignedPayload.trim()) {
    throw new Error("The wallet returned no transaction body. Please sign again.");
  }

  return transaction;
}
