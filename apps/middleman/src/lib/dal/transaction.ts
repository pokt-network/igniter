import { getDb } from '@/db'
import {InsertTransaction, Transaction, transactionsTable} from "@igniter/db/middleman/schema";
import {count, eq} from "drizzle-orm";

export async function countTransactions(): Promise<number> {
  const [{ value }] = await getDb().select({ value: count() }).from(transactionsTable)
  return value
}

export async function getTransactionsByUser(userIdentity: string) {
  return getDb().query.transactionsTable.findMany({
    where: eq(transactionsTable.createdBy, userIdentity),
    with: {
      provider: true,
    }
  });
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
