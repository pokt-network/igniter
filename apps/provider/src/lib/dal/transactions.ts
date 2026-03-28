import { getDbClient } from '@/db'
import { transactionsTable, keysTable, Transaction } from '@igniter/db/provider/schema'
import { TransactionType, TransactionStatus } from '@igniter/db/provider/enums'
import type { RemediationHistoryEntry } from '@igniter/db/provider/schema/keys'
import { desc, eq, count, sql } from 'drizzle-orm'

export async function listTransactions(limit = 50, offset = 0): Promise<Transaction[]> {
  const dbClient = getDbClient()
  return dbClient.db
    .select()
    .from(transactionsTable)
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit)
    .offset(offset)
}

export async function countTransactions(): Promise<number> {
  const dbClient = getDbClient()
  const [{ value }] = await dbClient.db
    .select({ value: count() })
    .from(transactionsTable)
  return value
}

export async function listTransactionsByKey(keyAddress: string): Promise<Transaction[]> {
  const dbClient = getDbClient()
  return dbClient.db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.keyAddress, keyAddress))
    .orderBy(desc(transactionsTable.createdAt))
}

/**
 * Counts how many remediation history entries exist across all keys (migratable data).
 */
export async function countMigratableHistoryEntries(): Promise<number> {
  const dbClient = getDbClient()
  const rows = await dbClient.db
    .select({
      remediationHistory: keysTable.remediationHistory,
    })
    .from(keysTable)
    .where(sql`json_array_length(${keysTable.remediationHistory}) > 0`)

  let total = 0
  for (const row of rows) {
    const history = (row.remediationHistory ?? []) as RemediationHistoryEntry[]
    total += history.filter((e) => e.txResult !== undefined).length
  }
  return total
}

/**
 * Migrates all remediationHistory entries into the transactions table.
 * Runs in a DB transaction — all or nothing.
 * Clears remediationHistory on each key after migration.
 */
export async function migrateRemediationHistory(): Promise<number> {
  const dbClient = getDbClient()

  const keys = await dbClient.db
    .select({
      id: keysTable.id,
      address: keysTable.address,
      remediationHistory: keysTable.remediationHistory,
    })
    .from(keysTable)
    .where(sql`json_array_length(${keysTable.remediationHistory}) > 0`)

  let migrated = 0

  await dbClient.db.transaction(async (tx) => {
    for (const key of keys) {
      const history = (key.remediationHistory ?? []) as RemediationHistoryEntry[]
      const entriesWithTx = history.filter((e) => e.txResult !== undefined)
      const entriesWithoutTx = history.filter((e) => e.txResult === undefined)

      if (entriesWithTx.length === 0) continue

      for (const entry of entriesWithTx) {
        await tx.insert(transactionsTable).values({
          keyId: key.id,
          keyAddress: key.address,
          type: TransactionType.Remediation,
          status: entry.txResult === 0 ? TransactionStatus.Success : TransactionStatus.Failure,
          reason: entry.reason,
          code: entry.txResult ?? null,
          message: entry.txResultDetails ?? null,
          details: entry.message ?? null,
          createdAt: new Date(entry.timestamp),
        })
        migrated++
      }

      // Keep transient detection entries, remove only migrated ones
      await tx
        .update(keysTable)
        .set({ remediationHistory: entriesWithoutTx })
        .where(eq(keysTable.id, key.id))
    }
  })

  return migrated
}
