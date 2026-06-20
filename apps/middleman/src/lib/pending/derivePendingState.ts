import { extractTransactionSuppliers } from '@igniter/commons/transactions/extractSuppliers'

export type PendingEntry = { kind: 'stake' | 'unstake'; txId: number; createdAt: Date }
export type PendingState = {
  byOperator: Record<string, PendingEntry>
  byOwner: Record<string, number>
  pendingStakeOperators: Array<{ operatorAddress: string; ownerAddress: string; txId: number; createdAt: Date }>
}

export function derivePendingState(
  pendingTxs: Array<{ id: number; type: string; unsignedPayload: string; createdAt: Date }>,
): PendingState {
  const byOperator: Record<string, PendingEntry> = {}
  const byOwner: Record<string, number> = {}
  const pendingStakeOperators: Array<{ operatorAddress: string; ownerAddress: string; txId: number; createdAt: Date }> = []

  for (const tx of pendingTxs) {
    const { kind, ownerAddress, operatorAddresses } = extractTransactionSuppliers(tx)
    if (kind === 'other' || !ownerAddress) continue
    byOwner[ownerAddress] = tx.id
    for (const op of operatorAddresses) {
      byOperator[op] = { kind, txId: tx.id, createdAt: tx.createdAt }
      if (kind === 'stake') {
        pendingStakeOperators.push({ operatorAddress: op, ownerAddress, txId: tx.id, createdAt: tx.createdAt })
      }
    }
  }

  return { byOperator, byOwner, pendingStakeOperators }
}
