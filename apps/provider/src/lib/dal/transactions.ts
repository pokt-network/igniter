import { getDbClient } from '@/db'
import { transactionsTable, keysTable, Transaction } from '@igniter/db/provider/schema'
import { TransactionType, TransactionStatus } from '@igniter/db/provider/enums'
import type { RemediationHistoryEntry } from '@igniter/db/provider/schema/keys'
import { and, desc, eq, count, sql, or, gte, inArray } from 'drizzle-orm'

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
 * Returns the addresses of keys that have an unstake transaction that is PENDING or
 * recently SUCCEEDED (within `lingerMs`). Used for fast in-progress "Unstaking…" feedback
 * on the keys list before key.state flips on verification. The linger bridges the race
 * where the unstake tx settles (no longer "pending") but the keys query hasn't yet
 * refetched the new state/retiredAt — without it the row briefly flickers back to
 * "Staked" between "Unstaking…" and "Retired". The per-row override only applies while
 * state===Staked, so the linger is harmless once the real state flip lands.
 */
export async function listKeyAddressesWithPendingUnstake(lingerMs = 120000): Promise<string[]> {
  const dbClient = getDbClient()
  const cutoff = new Date(Date.now() - lingerMs)
  const rows = await dbClient.db
    .select({ keyAddress: transactionsTable.keyAddress })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, TransactionType.Unstake),
        or(
          eq(transactionsTable.status, TransactionStatus.Pending),
          and(
            eq(transactionsTable.status, TransactionStatus.Success),
            // Linger off the settle time (lastVerificationAt) OR createdAt, so a tx that
            // takes longer than lingerMs to verify still shows its settled state instead
            // of vanishing — verification can outrun a created_at-only window.
            or(
              gte(transactionsTable.lastVerificationAt, cutoff),
              gte(transactionsTable.createdAt, cutoff),
            ),
          ),
        ),
      ),
    )
  return rows.map((r) => r.keyAddress)
}

/**
 * Returns full transaction rows that are PENDING or recently SETTLED (within `lingerMs`),
 * across all transaction types (stake / unstake / return_funds). Powers the keys
 * "In progress" section: pending rows show as "Staking…"/"Unstaking…" and recently-settled
 * rows linger briefly ("Staked"/"Unstaked"/"Failed") so the user sees the operation finish
 * before the row drops out. Provider transactions have NO updatedAt column, so the linger
 * is keyed off created_at (matches listKeyAddressesWithPendingUnstake's window semantics).
 */
export async function getPendingAndRecentlySettledTransactions(lingerMs = 120000): Promise<Transaction[]> {
  const dbClient = getDbClient()
  const cutoff = new Date(Date.now() - lingerMs)
  return dbClient.db
    .select()
    .from(transactionsTable)
    .where(
      or(
        eq(transactionsTable.status, TransactionStatus.Pending),
        and(
          inArray(transactionsTable.status, [TransactionStatus.Success, TransactionStatus.Failure]),
          // Linger off the settle time (lastVerificationAt) OR createdAt — a slow-verifying
          // tx settles after its created_at window would have closed; keying off the
          // verification time keeps its settled row visible for the linger.
          or(
            gte(transactionsTable.lastVerificationAt, cutoff),
            gte(transactionsTable.createdAt, cutoff),
          ),
        ),
      ),
    )
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
