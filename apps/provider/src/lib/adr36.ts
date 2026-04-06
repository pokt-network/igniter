import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import { fromHex, fromBase64 } from '@cosmjs/encoding'
import { serializeSignDoc, type StdSignDoc } from '@cosmjs/amino'

/**
 * Verifies an ADR-36 signature as produced by Keplr's signArbitrary.
 * Keplr wraps the message in a StdSignDoc with sign/MsgSignData before signing.
 */
export async function verifyAdr36Signature(
  payload: string,
  signerAddress: string,
  publicKeyHex: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = fromHex(publicKeyHex)

    const signDoc: StdSignDoc = {
      chain_id: '',
      account_number: '0',
      sequence: '0',
      fee: { amount: [], gas: '0' },
      memo: '',
      msgs: [
        {
          type: 'sign/MsgSignData',
          value: {
            signer: signerAddress,
            data: Buffer.from(new TextEncoder().encode(payload)).toString('base64'),
          },
        },
      ],
    }

    const signBytes = serializeSignDoc(signDoc)
    const messageHash = sha256(signBytes)
    const signature = fromBase64(signatureBase64)

    return await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(signature.subarray(0, 64)),
      messageHash,
      publicKeyBytes,
    )
  } catch (e: unknown) {
    console.error('ADR-36 signature verification failed:', (e as Error).message)
    return false
  }
}