'use server'

import { requireAuth } from '@/lib/utils/actions'
import { getPendingTransactionsByUser } from '@/lib/dal/transaction'
import { derivePendingState, type PendingStateSerialized } from '@/lib/pending/derivePendingState'

export async function GetPendingState(): Promise<PendingStateSerialized> {
  const userIdentity = await requireAuth()
  const pendingTxs = await getPendingTransactionsByUser(userIdentity)
  const state = derivePendingState(pendingTxs)

  return {
    byOwner: state.byOwner,
    byOperator: Object.fromEntries(
      Object.entries(state.byOperator).map(([op, entry]) => [
        op,
        { ...entry, createdAt: entry.createdAt ? entry.createdAt.toISOString() : null },
      ]),
    ),
    pendingStakeOperators: state.pendingStakeOperators.map((item) => ({
      ...item,
      createdAt: item.createdAt ? item.createdAt.toISOString() : null,
    })),
    pendingOperations: state.pendingOperations.map((op) => ({
      ...op,
      createdAt: op.createdAt ? op.createdAt.toISOString() : null,
    })),
  }
}
