import { TransactionStatus } from '@igniter/db/middleman/enums'

/**
 * The only fields the `updateTransaction` ACTIVITY may write. Activity inputs are not
 * trusted (they arrive through the Temporal task queue), so the activity takes no
 * `Partial<Transaction>`: a `signedPayload`, `unsignedPayload`, `providerId`,
 * `createdBy` or a `status` flip to Success in the input is refused, not written.
 * These are exactly the fields ExecuteTransaction writes.
 */
export type TransactionUpdatePatch = {
  status?: TransactionStatus.Failure
  log?: string
  code?: number
  executionHeight?: number
  hash?: string
  timeoutHeight?: number | null
}

const MAX_LOG_LEN = 10_000
const HASH_RE = /^[0-9A-Fa-f]{64}$/

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/** Validates and copies only the allowed fields; throws on any other key or a bad value. */
export function parseTransactionUpdatePatch(payload: unknown): TransactionUpdatePatch {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('updateTransaction: payload must be an object')
  }
  const p = payload as Record<string, unknown>
  const out: TransactionUpdatePatch = {}
  for (const [key, value] of Object.entries(p)) {
    if (value === undefined) continue
    switch (key) {
      case 'status':
        if (value !== TransactionStatus.Failure) throw new Error('updateTransaction: status may only be set to failure')
        out.status = TransactionStatus.Failure
        break
      case 'log':
        if (typeof value !== 'string') throw new Error('updateTransaction: log must be a string')
        out.log = value.slice(0, MAX_LOG_LEN)
        break
      case 'code':
        if (!isInt(value)) throw new Error('updateTransaction: code must be an integer')
        out.code = value
        break
      case 'executionHeight':
        if (!isInt(value) || value < 0) throw new Error('updateTransaction: executionHeight must be a non-negative integer')
        out.executionHeight = value
        break
      case 'hash':
        if (typeof value !== 'string' || !HASH_RE.test(value)) throw new Error('updateTransaction: hash must be 64 hex chars')
        out.hash = value
        break
      case 'timeoutHeight':
        if (value !== null && (!isInt(value) || value < 0)) throw new Error('updateTransaction: timeoutHeight must be a non-negative integer or null')
        out.timeoutHeight = value as number | null
        break
      default:
        throw new Error(`updateTransaction: field "${key}" is not updatable`)
    }
  }
  return out
}
