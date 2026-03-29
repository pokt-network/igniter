'use server'

import {
  listTransactions,
  countTransactions,
  countMigratableHistoryEntries,
  migrateRemediationHistory,
} from '@/lib/dal/transactions'
import { type ActionResult, withRequireOwner } from '@/lib/utils/actionUtils'
import type { Transaction } from '@igniter/db/provider/schema'

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
