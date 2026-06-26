import { getDb } from '@/db'
import {InsertTransaction, Transaction, transactionsTable} from "@igniter/db/middleman/schema";
import {count, eq, and, or, gte, inArray} from "drizzle-orm";
import { TransactionStatus } from "@igniter/db/middleman/enums";

export async function countTransactions(): Promise<number> {
  const [{ value }] = await getDb().select({ value: count() }).from(transactionsTable)
  return value
}

export async function countTransactionsByUser(userIdentity: string): Promise<number> {
  const result = await getDb()
    .select({ value: count() })
    .from(transactionsTable)
    .where(eq(transactionsTable.createdBy, userIdentity))
  return result[0]?.value ?? 0
}

export async function getTransactionsByUser(userIdentity: string) {
  return getDb().query.transactionsTable.findMany({
    where: eq(transactionsTable.createdBy, userIdentity),
    with: {
      provider: true,
    }
  });
}

export async function getPendingTransactionsByUser(userIdentity: string) {
  return getDb().query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.createdBy, userIdentity),
      eq(transactionsTable.status, TransactionStatus.Pending),
    ),
    with: { provider: true },
  })
}

export async function getPendingAndRecentlySettledTransactionsByUser(
  userIdentity: string,
  settledWithinMs = 120000,
) {
  const cutoff = new Date(Date.now() - settledWithinMs)
  return getDb().query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.createdBy, userIdentity),
      or(
        eq(transactionsTable.status, TransactionStatus.Pending),
        and(
          inArray(transactionsTable.status, [TransactionStatus.Success, TransactionStatus.Failure]),
          gte(transactionsTable.updatedAt, cutoff),
        ),
      ),
    ),
    with: { provider: true },
  })
}

export async function getTransactions() {
    return getDb().query.transactionsTable.findMany({
        with: {
            provider: true,
        }
    });
}

export async function insert(transaction: InsertTransaction): Promise<Transaction> {
  const [createdTransaction] = await getDb().insert(transactionsTable).values(transaction).returning();
  if (!createdTransaction) {
    throw new Error("Failed to insert transaction");
  }
  return createdTransaction;
}
