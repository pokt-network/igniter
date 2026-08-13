import {fromHex, toHex} from "@cosmjs/encoding";
import {getLogger, type Logger} from '@igniter/logger'

export function isValidPrivateKey(privateKey: string, logger: Logger = getLogger(['pocket', 'utils'])): boolean {
  const privateKeyAsUint = fromHex(privateKey)

  if (privateKeyAsUint.length !== 32) {
    logger.error('Invalid private key length. Must be 32 bytes.')
    return false
  }

  const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141') // Order of the Secp256k1 curve
  const privateKeyValue = BigInt(`0x${toHex(privateKeyAsUint)}`)
  if (privateKeyValue <= 0 || privateKeyValue >= n) {
    logger.error('Invalid private key value. Must be between 1 and n - 1.')
    return false
  }

  return true
}