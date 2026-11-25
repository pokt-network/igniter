import {fromBech32, fromHex, toHex} from "@cosmjs/encoding";
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
/**
 * True when `address` is a well-formed bech32 account address with the `pokt`
 * human-readable prefix and a 20-byte payload. Used to validate drain/return-funds
 * destinations before they are written to, or read from, a transaction intent.
 */
export function isValidPoktAddress(address: unknown): address is string {
  if (typeof address !== 'string' || address.length === 0 || address.length > 90) return false
  try {
    const { prefix, data } = fromBech32(address)
    return prefix === 'pokt' && data.length === 20
  } catch {
    return false
  }
}

/**
 * Hosts allowed to serve the Pocket RPC/API over plain http: loopback and
 * single-label (cluster-internal, e.g. localnet's `validator`) names. Everything
 * else must be https, so nothing on the network path can rewrite the chain state the
 * workers act on (supplier owner, balances).
 */
function isPlainHttpAllowedHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h)) return true
  return /^[a-z0-9-]+$/.test(h)
}

/**
 * Throws unless `rawUrl` is https, or http to a loopback / single-label host.
 */
export function assertSecureRpcUrl(rawUrl: string, label = 'RPC'): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid Pocket ${label} URL`)
  }
  if (url.protocol === 'https:' || url.protocol === 'wss:') return
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && isPlainHttpAllowedHost(url.hostname)) return
  throw new Error(`Pocket ${label} URL must use https (http is allowed only for localhost or a cluster-internal host): ${url.protocol}//${url.hostname}`)
}
