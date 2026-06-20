import {
  extractTransactionStakingSuppliers,
  extractTransactionUnstakingSuppliers,
  extractTransactionSuppliers,
} from '@igniter/commons/transactions/extractSuppliers'

export type PendingEntry = { kind: 'stake' | 'unstake'; txId: number; createdAt: Date | null }

export type PendingOperation = {
  kind: 'stake' | 'unstake'
  operatorAddress: string
  ownerAddress: string | null
  providerName: string | null
  stakeAmountUpokt: string | null
  hash: string | null
  createdAt: Date | null
}

export type PendingState = {
  byOperator: Record<string, PendingEntry>
  byOwner: Record<string, number>
  pendingStakeOperators: Array<{ operatorAddress: string; ownerAddress: string; txId: number; createdAt: Date | null }>
  pendingOperations: Array<PendingOperation>
}

export type PendingEntrySerialized = { kind: 'stake' | 'unstake'; txId: number; createdAt: string | null }

export type PendingOperationSerialized = {
  kind: 'stake' | 'unstake'
  operatorAddress: string
  ownerAddress: string | null
  providerName: string | null
  stakeAmountUpokt: string | null
  hash: string | null
  createdAt: string | null
}

export type PendingStateSerialized = {
  byOperator: Record<string, PendingEntrySerialized>
  byOwner: Record<string, number>
  pendingStakeOperators: Array<{ operatorAddress: string; ownerAddress: string; txId: number; createdAt: string | null }>
  pendingOperations: Array<PendingOperationSerialized>
}

export function derivePendingState(
  pendingTxs: Array<{
    id: number
    type: string
    unsignedPayload: string
    hash: string | null
    provider: { name: string } | null
    createdAt: Date | null
  }>,
): PendingState {
  const byOperator: Record<string, PendingEntry> = {}
  const byOwner: Record<string, number> = {}
  const pendingStakeOperators: Array<{ operatorAddress: string; ownerAddress: string; txId: number; createdAt: Date | null }> = []

  // pendingOperations map: operatorAddress → PendingOperation; unstake wins over stake
  const pendingOpsMap = new Map<string, PendingOperation>()

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

    // Build pendingOperations entries
    if (kind === 'stake') {
      const stakeInfos = extractTransactionStakingSuppliers(tx)
      for (const info of stakeInfos) {
        // Only add stake if no unstake entry already exists for this operator
        if (!pendingOpsMap.has(info.address) || pendingOpsMap.get(info.address)!.kind !== 'unstake') {
          pendingOpsMap.set(info.address, {
            kind: 'stake',
            operatorAddress: info.address,
            ownerAddress: info.ownerAddress,
            providerName: tx.provider?.name ?? null,
            stakeAmountUpokt: info.stakeAmount,
            hash: tx.hash,
            createdAt: tx.createdAt,
          })
        }
      }
    } else if (kind === 'unstake') {
      const unstakeInfos = extractTransactionUnstakingSuppliers(tx)
      for (const info of unstakeInfos) {
        // Unstake always wins
        pendingOpsMap.set(info.operatorAddress, {
          kind: 'unstake',
          operatorAddress: info.operatorAddress,
          ownerAddress: info.signer,
          providerName: tx.provider?.name ?? null,
          stakeAmountUpokt: null,
          hash: tx.hash,
          createdAt: tx.createdAt,
        })
      }
    }
  }

  return { byOperator, byOwner, pendingStakeOperators, pendingOperations: Array.from(pendingOpsMap.values()) }
}
