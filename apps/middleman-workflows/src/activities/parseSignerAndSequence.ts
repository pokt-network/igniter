import { TxRaw, AuthInfo, TxBody } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'

/**
 * Parses signer sequence and timeoutHeight from a base64-encoded signed TxRaw payload.
 * Returns null values on parse failure (activity caller treats as no evidence → pending).
 */
export function parseSignerAndSequence(signedPayload: string): {
  sequence: number | null
  timeoutHeight: number | null
} {
  try {
    const txBytes = Buffer.from(signedPayload, 'base64')
    const txRaw = TxRaw.decode(txBytes)
    const authInfo = AuthInfo.decode(txRaw.authInfoBytes)
    const sequence = authInfo.signerInfos[0]?.sequence ?? null
    const body = TxBody.decode(txRaw.bodyBytes)
    const timeoutHeight = body.timeoutHeight || null
    return {
      sequence: sequence !== null ? Number(sequence) : null,
      timeoutHeight: timeoutHeight ? Number(timeoutHeight) : null,
    }
  } catch {
    return { sequence: null, timeoutHeight: null }
  }
}
