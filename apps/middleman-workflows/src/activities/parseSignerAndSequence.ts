import { TxRaw, AuthInfo, TxBody } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'

/**
 * Parses signer sequence and timeoutHeight from a HEX-encoded signed TxRaw payload.
 *
 * Encoding matters and is app-specific: middleman payloads are hex — both wallets store them
 * that way (KeplrWalletConnection `toString("hex")`, PocketWalletConnection `transactionHex`)
 * and the broadcaster decodes them with `Buffer.from(payload, 'hex')`. Provider payloads are
 * base64; this function is middleman-only and must not be pointed at provider data.
 *
 * This decoded base64 until #339. Because hex digits are also valid base64 characters, the
 * mistake never threw at the decode step — it produced garbage bytes, TxRaw.decode failed, and
 * the catch below returned nulls for EVERY transaction. That silently removed the only evidence
 * `decideVerification` can use to declare a tx absent, so no middleman transaction could ever
 * reach a failure verdict; they stayed pending forever.
 *
 * Returns null values on parse failure (activity caller treats as no evidence → pending).
 */
export function parseSignerAndSequence(signedPayload: string): {
  sequence: number | null
  timeoutHeight: number | null
} {
  try {
    const txBytes = Buffer.from(signedPayload, 'hex')
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
