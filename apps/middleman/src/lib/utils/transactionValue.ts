import { MessageType } from '@igniter/commons/constants'
import { TransactionType } from '@igniter/db/middleman/enums'
import type { Operation } from '@/app/detail/TransactionDetail'

/**
 * "Total POKT" for a transaction, in uPOKT, or null when it is unknown.
 *
 * Prefers the stored `transactions.amount`, falling back to summing the
 * unsigned payload (`transactions.unsignedPayload`; `signedPayload` is a
 * separate column). The stored value exists because MsgUnstakeSupplier carries no amount:
 * an unstake's value can only come from the suppliers' stake at the time it was
 * created, so it cannot be recomputed from the payload afterwards. Rows created
 * before that column existed still have a null amount and fall back.
 *
 * For an Unstake the fallback is not a fallback: its payload always sums to
 * zero, so without a usable stored amount the value is simply unknown. That
 * case returns null so the caller can render it as such, instead of a 0.00
 * that looks exactly like the bug the stored column fixes.
 */
export function resolveTransactionTotalValue(
  amount: string | null | undefined,
  type: TransactionType,
  sumFromOperations: () => number,
): number | null {
  // Digits only. uPOKT is an unsigned integer, and Number() is far too
  // permissive for a value that, once accepted, is treated as authoritative and
  // suppresses the payload fallback for good: it turns '  ' into 0, '0x10' into
  // 16, '1e3' into 1000, and takes '-5' at face value. Anything that is not a
  // plain run of digits falls back instead.
  // A stored '0' counts as unset, matching the writers: the shared query returns
  // null rather than a zero total, and the workflow self-heal treats a stored
  // '0' as still-unhealed. Honouring it here would pin 0.00 on a row the rest of
  // the system considers unresolved.
  if (amount !== null && amount !== undefined && /^\d+$/.test(amount.trim()) && Number(amount) !== 0) {
    const parsed = Number(amount.trim())
    if (Number.isSafeInteger(parsed)) {
      return parsed
    }
  }

  if (type === TransactionType.Unstake) {
    return null
  }

  return sumFromOperations()
}

/**
 * Payload sum used by the transaction lists: every value-bearing message,
 * regardless of transaction type. Note this includes the operational-funds Send
 * that accompanies a Stake, which is why the detail view uses a narrower sum.
 */
export function sumOperationsValue(operations: Array<Operation>): number {
  return operations.reduce((acc, op) => {
    if (op.typeUrl === MessageType.Send) {
      return acc + Number(op.value.amount.at(0)?.amount || 0)
    }

    if (op.typeUrl === MessageType.Stake) {
      return acc + Number(op.value.stake.amount)
    }

    return acc
  }, 0)
}
