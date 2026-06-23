'use server'

import {
  listTransactions,
  countTransactions,
  countMigratableHistoryEntries,
  migrateRemediationHistory,
  listKeyAddressesWithPendingUnstake,
  getPendingAndRecentlySettledTransactions,
} from '@/lib/dal/transactions'
import { type ActionResult, withRequireOwner } from '@/lib/utils/actionUtils'
import type { Transaction } from '@igniter/db/provider/schema'
import {
  derivePendingState,
  type PendingStateSerialized,
} from '@/lib/pending/derivePendingState'

export async function ListTransactions(limit = 50, offset = 0): Promise<ActionResult<Transaction[]>> {
  return withRequireOwner(async () => {
    return listTransactions(limit, offset)
  })
}

export async function CountTransactions(): Promise<ActionResult<number>> {
  return withRequireOwner(async () => {
    return countTransactions()
  })
}

export async function CountMigratableHistory(): Promise<ActionResult<number>> {
  return withRequireOwner(async () => {
    return countMigratableHistoryEntries()
  })
}

export async function MigrateRemediationHistory(): Promise<ActionResult<number>> {
  return withRequireOwner(async () => {
    return migrateRemediationHistory()
  })
}

export async function ListPendingUnstakeAddresses(): Promise<ActionResult<string[]>> {
  return withRequireOwner(async () => {
    return listKeyAddressesWithPendingUnstake()
  })
}

/**
 * Returns the derived "In progress" state for the keys section: pending + recently-settled
 * (120s linger) transactions across all types. Serializes Date -> ISO string at the boundary
 * (amounts are not stored on provider transactions, so no bigint crosses the wire) so the
 * client receives plain JSON.
 */
export async function GetKeysPendingState(): Promise<ActionResult<PendingStateSerialized>> {
  return withRequireOwner(async () => {
    const txs = await getPendingAndRecentlySettledTransactions()
    const state = derivePendingState(txs)
    return {
      byKey: state.byKey,
      pendingOperations: state.pendingOperations.map((op) => ({
        ...op,
        createdAt: op.createdAt ? op.createdAt.toISOString() : null,
      })),
    }
  })
}
