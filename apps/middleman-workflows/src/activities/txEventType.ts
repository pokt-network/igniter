import { TransactionType } from '@igniter/db/middleman/enums'

export type TxUserEventType = 'stake' | 'unstake' | 'upstake' | 'operational_funds'

// Maps a transaction type to the per-user notification event it should emit.
// Types with no user-facing event return undefined (dispatch is skipped).
// Shared by the verifier's terminal hook and the broadcaster's failure hook so
// both paths agree on which tx types notify the owner.
export function txTypeToUserEventType(type: TransactionType): TxUserEventType | undefined {
  switch (type) {
    case TransactionType.Stake:
      return 'stake'
    case TransactionType.Unstake:
      return 'unstake'
    case TransactionType.Upstake:
      return 'upstake'
    case TransactionType.OperationalFunds:
      return 'operational_funds'
    default:
      return undefined
  }
}
