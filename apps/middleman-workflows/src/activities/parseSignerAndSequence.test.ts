import { TxRaw, TxBody, AuthInfo } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import { parseSignerAndSequence } from './parseSignerAndSequence'

/**
 * Regression guard for #339's blocker: this decoded base64 while middleman stores hex, so it
 * returned nulls for every transaction. That starved `decideVerification` of the timeoutHeight
 * and sequence evidence it needs to declare a tx absent, leaving failed transactions pending
 * forever. Hex digits are valid base64 characters, so the bug never threw where anyone could
 * see it — hence this file, which the function shipped two releases without.
 */
function buildSignedPayloadHex({ sequence, timeoutHeight }: { sequence: number; timeoutHeight: number }): string {
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages: [], timeoutHeight })).finish()
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [{ sequence }],
  })).finish()
  const txRawBytes = TxRaw.encode(TxRaw.fromPartial({
    bodyBytes,
    authInfoBytes,
    signatures: [new Uint8Array([1, 2, 3])],
  })).finish()
  return Buffer.from(txRawBytes).toString('hex')
}

describe('parseSignerAndSequence', () => {
  it('reads sequence and timeoutHeight from a hex payload (the encoding middleman stores)', () => {
    const payload = buildSignedPayloadHex({ sequence: 7, timeoutHeight: 1030 })

    expect(parseSignerAndSequence(payload)).toEqual({ sequence: 7, timeoutHeight: 1030 })
  })

  it('returns a sequence with timeoutHeight null when the wallet embedded no timeout', () => {
    const payload = buildSignedPayloadHex({ sequence: 12, timeoutHeight: 0 })

    expect(parseSignerAndSequence(payload)).toEqual({ sequence: 12, timeoutHeight: null })
  })

  it('does NOT parse a base64 payload — the pre-#339 encoding this regressed on', () => {
    const hex = buildSignedPayloadHex({ sequence: 7, timeoutHeight: 1030 })
    const base64 = Buffer.from(hex, 'hex').toString('base64')

    // Proves the two encodings are not interchangeable: whichever one the function decodes,
    // the other yields no evidence. Middleman is hex, so hex is the one that must work.
    expect(parseSignerAndSequence(base64)).toEqual({ sequence: null, timeoutHeight: null })
  })

  it('returns nulls on garbage instead of throwing', () => {
    expect(parseSignerAndSequence('not-a-payload')).toEqual({ sequence: null, timeoutHeight: null })
    expect(parseSignerAndSequence('')).toEqual({ sequence: null, timeoutHeight: null })
  })
})
