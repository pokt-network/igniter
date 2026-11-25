/**
 * Server side of the wallet sign-in (both apps' `authorize`). A login is accepted only when:
 * - the message nonce is one this server issued to this browser (a signed, 5-minute cookie set by
 *   the app's `/api/login-nonce` route) and has not been used before in this process;
 * - the message chain id is the app's chain;
 * - `issuedAt` is at most 5 minutes old and `expirationTime` is set, in the future and at most
 *   10 minutes after `issuedAt`;
 * - the signature verifies (ERC-4361 with a hex public key, or ADR-36 with a base64 one), which
 *   binds the message address to the public key.
 *
 * Server-only: it uses node:crypto and the AUTH_SECRET.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { SiwpMessage } from '@poktscan/vault-siwp'

export const LOGIN_NONCE_TTL_MS = 5 * 60 * 1000
export const MAX_ISSUED_AT_AGE_MS = 5 * 60 * 1000
export const MAX_CLOCK_SKEW_MS = 60 * 1000
export const MAX_MESSAGE_LIFETIME_MS = 10 * 60 * 1000

export class SiwpLoginError extends Error {
  constructor(public readonly reason: string) {
    super(`Sign-in refused: ${reason}`)
    this.name = 'SiwpLoginError'
  }
}

/** `__Host-` (Secure, Path=/, no Domain) when the app is served over https. */
export function loginNonceCookieName(app: string, secure: boolean): string {
  return `${secure ? '__Host-' : ''}${app}.login-nonce`
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** A fresh nonce and the signed cookie value that carries it (`nonce.expiresAt.hmac`). */
export function mintLoginNonce(secret: string, now: number = Date.now()) {
  const nonce = randomBytes(16).toString('hex')
  const expiresAt = now + LOGIN_NONCE_TTL_MS
  const cookieValue = `${nonce}.${expiresAt}.${sign(secret, `${nonce}.${expiresAt}`)}`
  // The message times come from the server clock too, so a browser with a wrong clock can still sign in.
  const issuedAt = new Date(now).toISOString()
  const expirationTime = new Date(expiresAt).toISOString()
  return { nonce, issuedAt, expirationTime, expiresAt, cookieValue, maxAgeSeconds: LOGIN_NONCE_TTL_MS / 1000 }
}

/** The nonce in a valid, unexpired cookie, or null. */
export function readLoginNonceCookie(secret: string, cookieValue: string | undefined, now: number = Date.now()): string | null {
  if (!cookieValue) return null
  const [nonce, expiresAtRaw, mac] = cookieValue.split('.')
  if (!nonce || !expiresAtRaw || !mac) return null
  const expected = Buffer.from(sign(secret, `${nonce}.${expiresAtRaw}`))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || now >= expiresAt) return null
  return nonce
}

/** Reads one cookie from a request's Cookie header. */
export function cookieFromRequest(request: Request | undefined, name: string): string | undefined {
  const header = request?.headers?.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim())
    }
  }
  return undefined
}

// Nonces already used in this process, kept until they expire. Per process: with several replicas
// a nonce could be used once per replica within its 5 minutes, and only from the browser holding
// the cookie. So the web apps run as ONE replica (middleman replicas = 1, set in pnf-ops); scaling
// out needs a shared store (a DB table of consumed nonces) first.
const consumedNonces = new Map<string, number>()

function consumeNonce(nonce: string, expiresAt: number, now: number): boolean {
  for (const [used, until] of consumedNonces) {
    if (until <= now) consumedNonces.delete(used)
  }
  if (consumedNonces.has(nonce)) return false
  consumedNonces.set(nonce, expiresAt)
  return true
}

// vault-siwp console.logs the message, the sign-doc and the signature bytes while it verifies.
// Silence console for the duration of the verify calls; a depth counter keeps overlapping logins
// from restoring a silenced console as the original.
let silenceDepth = 0
let savedConsole: Pick<Console, 'log' | 'info' | 'debug'> | null = null

async function withConsoleSilenced<T>(fn: () => Promise<T>): Promise<T> {
  if (silenceDepth === 0) {
    savedConsole = { log: console.log, info: console.info, debug: console.debug }
    console.log = console.info = console.debug = () => {}
  }
  silenceDepth++
  try {
    return await fn()
  } finally {
    silenceDepth--
    if (silenceDepth === 0 && savedConsole) {
      console.log = savedConsole.log
      console.info = savedConsole.info
      console.debug = savedConsole.debug
      savedConsole = null
    }
  }
}

function parseTime(value: unknown, field: string): number {
  if (typeof value !== 'string' || !value) throw new SiwpLoginError(`${field} is required`)
  const time = Date.parse(value)
  if (Number.isNaN(time)) throw new SiwpLoginError(`${field} is not a date`)
  return time
}

export interface SiwpLoginOptions {
  /** The host the message must name (the app's AUTH_URL host). */
  domain: string
  /** The app's chain id (what WalletPicker sets as the message chain id). */
  chainId: string
  /** AUTH_SECRET, the key of the nonce cookie. */
  secret: string
  /** The raw login-nonce cookie of the request. */
  nonceCookie: string | undefined
  now?: number
}

/**
 * Verifies a wallet sign-in. Returns the authenticated address (the message address, bound to the
 * public key by the signature check), or throws SiwpLoginError.
 */
export async function verifySiwpLogin(
  credentials: Partial<Record<'message' | 'signature' | 'publicKey', unknown>> | undefined,
  options: SiwpLoginOptions,
): Promise<string> {
  const now = options.now ?? Date.now()

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(String(credentials?.message ?? '')) as Record<string, unknown>
  } catch {
    throw new SiwpLoginError('the message is not valid JSON')
  }
  if (!raw || typeof raw !== 'object') throw new SiwpLoginError('the message is not an object')

  // Checked on the raw fields: SiwpMessage fills a missing nonce or issuedAt with fresh values.
  const issuedAt = parseTime(raw.issuedAt, 'issuedAt')
  const expirationTime = parseTime(raw.expirationTime, 'expirationTime')
  if (typeof raw.nonce !== 'string' || !raw.nonce) throw new SiwpLoginError('nonce is required')

  let message: SiwpMessage
  try {
    message = new SiwpMessage(raw as unknown as ConstructorParameters<typeof SiwpMessage>[0])
  } catch {
    throw new SiwpLoginError('the message is malformed')
  }

  const issuedNonce = readLoginNonceCookie(options.secret, options.nonceCookie, now)
  if (!issuedNonce || issuedNonce !== message.nonce) {
    throw new SiwpLoginError('the nonce was not issued by this server')
  }
  if (message.chainId !== options.chainId) throw new SiwpLoginError('wrong chain id')
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) throw new SiwpLoginError('issuedAt is in the future')
  if (now - issuedAt > MAX_ISSUED_AT_AGE_MS) throw new SiwpLoginError('the message is too old')
  if (expirationTime <= now) throw new SiwpLoginError('the message has expired')
  if (expirationTime - issuedAt > MAX_MESSAGE_LIFETIME_MS) throw new SiwpLoginError('expirationTime is too far ahead')

  const signature = String(credentials?.signature ?? '')
  const publicKey = String(credentials?.publicKey ?? '')
  const verified = await withConsoleSilenced(async () => {
    const [erc4361, adr36] = await Promise.all([
      message.verifyERC4361({ signature, publicKey, domain: options.domain }, { suppressExceptions: true }).catch(() => null),
      message.verifyAdr36({ signature, publicKey, domain: options.domain }, { suppressExceptions: true }).catch(() => null),
    ])
    return erc4361?.success === true || adr36?.success === true
  })
  if (!verified) throw new SiwpLoginError('the signature does not verify')

  // Single use: a captured message and signature cannot be replayed with the same cookie.
  const [, expiresAtRaw] = String(options.nonceCookie).split('.')
  if (!consumeNonce(issuedNonce, Number(expiresAtRaw), now)) throw new SiwpLoginError('the nonce was already used')

  return message.address
}
