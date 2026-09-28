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
 * `unordered` and `timeoutTimestamp` matter because an unordered tx is signed with sequence 0
 * and never consumes it: its sequence says nothing about whether it landed, and the only bound
 * on it is chain time passing `timeoutTimestamp`. Reading an unordered tx as ordered made the
 * "sequence consumed" rule fail landed txs before they reached a block (tx 459, v0.17.0).
 *
 * Returns null values on parse failure (activity caller treats as no evidence → pending).
 */
export function parseSignerAndSequence(signedPayload: string): {
  sequence: number | null
  timeoutHeight: number | null
  unordered: boolean
  timeoutTimestamp: Date | null
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
      unordered: body.unordered,
      timeoutTimestamp: body.timeoutTimestamp ?? null,
    }
  } catch {
    return { sequence: null, timeoutHeight: null, unordered: false, timeoutTimestamp: null }
  }
}
