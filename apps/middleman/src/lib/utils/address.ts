import { fromBech32 } from '@cosmjs/encoding'

export const POKT_ADDRESS_PREFIX = 'pokt'

/**
 * True for a bech32 account address with the `pokt` prefix and a 20-byte payload. Used before an
 * address that came from a caller is put into a URL path.
 */
export function isPoktAddress(address: unknown): address is string {
  if (typeof address !== 'string' || address.length > 100) return false
  try {
    const { prefix, data } = fromBech32(address)
    return prefix === POKT_ADDRESS_PREFIX && data.length === 20
  } catch {
    return false
  }
}

export function assertPoktAddress(address: unknown): string {
  if (!isPoktAddress(address)) throw new Error('Invalid address')
  return address
}
