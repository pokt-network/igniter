import { isPoktBech32Address } from '@igniter/commons/crypto'

export type ReturnFundsInput = { mode: 'none' } | { mode: 'owner' } | { mode: 'custom'; address: string }

/**
 * Pure validation for the per-operation return-funds choice. Lives outside the
 * `'use server'` action module because Next.js requires every export of a server
 * action file to be an async function.
 */
export function validateReturnFunds(rf: ReturnFundsInput): { ok: true } | { ok: false; message: string } {
  if (rf.mode === 'custom' && !isPoktBech32Address(rf.address)) {
    return { ok: false, message: 'Invalid destination address' }
  }
  return { ok: true }
}
