import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { dirname } from 'node:path'
import { SiwpMessage } from '@poktscan/vault-siwp'
import {
  cookieFromRequest,
  loginNonceCookieName,
  mintLoginNonce,
  readLoginNonceCookie,
  SiwpLoginError,
  verifySiwpLogin,
} from './siwpLogin'

// Real keys and the real vault-siwp verifiers. The helpers vault-siwp itself uses for the address
// and the ADR-36 sign-doc are loaded from its own dependency tree.
const siwpDir = dirname(require.resolve('@poktscan/vault-siwp'))
const fromSiwp = (id: string) => require(require.resolve(id, { paths: [siwpDir] }))
const { serializeSignDoc } = fromSiwp('@cosmjs/amino')
const { sha256 } = fromSiwp('@noble/hashes/sha256')
const { ripemd160 } = fromSiwp('@noble/hashes/ripemd160')
const { toBech32 } = fromSiwp('@cosmjs/encoding')

const SECRET = 's'.repeat(32)
const DOMAIN = 'middleman.example'
const CHAIN_ID = 'pocket'
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')

type Key = { privateKey: KeyObject; compressed: Buffer; uncompressed: Buffer; address: string }

function makeKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x!, 'base64url')
  const y = Buffer.from(jwk.y!, 'base64url')
  const compressed = Buffer.concat([Buffer.from([(y[31] ?? 0) % 2 === 0 ? 2 : 3]), x])
  const uncompressed = Buffer.concat([Buffer.from([4]), x, y])
  const address = toBech32('pokt', ripemd160(sha256(compressed)))
  return { privateKey, compressed, uncompressed, address }
}

/** secp256k1 over sha256(data), compact r||s with low S (what wallets produce and noble requires). */
function signCompact(key: Key, data: Uint8Array): Buffer {
  const sig = sign('sha256', data, { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
  const r = sig.subarray(0, 32)
  let s = BigInt('0x' + sig.subarray(32).toString('hex'))
  if (s > N / 2n) s = N - s
  return Buffer.concat([r, Buffer.from(s.toString(16).padStart(64, '0'), 'hex')])
}

function makeMessage(address: string, nonce: string, overrides: Record<string, unknown> = {}, now = Date.now()) {
  return new SiwpMessage({
    domain: DOMAIN,
    address,
    statement: 'Sign in to Igniter',
    uri: `https://${DOMAIN}`,
    version: '1',
    chainId: CHAIN_ID,
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 5 * 60 * 1000).toISOString(),
    ...overrides,
  } as ConstructorParameters<typeof SiwpMessage>[0])
}

/** Soothe-style (ERC-4361): hex public key, hex signature over sha256(message text). */
function erc4361Credentials(signer: Key, message: SiwpMessage, publicKey: Buffer = signer.compressed) {
  const text = message.prepareMessage()
  return {
    message: JSON.stringify(message),
    signature: signCompact(signer, new TextEncoder().encode(text)).toString('hex'),
    publicKey: publicKey.toString('hex'),
  }
}

/** Keplr-style (ADR-36): base64 public key, base64 signature over the amino sign-doc. */
function adr36Credentials(signer: Key, message: SiwpMessage) {
  const signDoc = {
    chain_id: '', account_number: '0', sequence: '0', fee: { amount: [], gas: '0' }, memo: '',
    msgs: [{ type: 'sign/MsgSignData', value: { signer: message.address, data: Buffer.from(message.prepareMessage()).toString('base64') } }],
  }
  return {
    message: JSON.stringify(message),
    signature: signCompact(signer, serializeSignDoc(signDoc)).toString('base64'),
    publicKey: signer.compressed.toString('base64'),
  }
}

function freshNonce(now = Date.now()) {
  return mintLoginNonce(SECRET, now)
}

const options = (cookie: string, now?: number) => ({ domain: DOMAIN, chainId: CHAIN_ID, secret: SECRET, nonceCookie: cookie, now })

describe('verifySiwpLogin with real signatures', () => {
  it('accepts an ERC-4361 login (hex key) and returns the message address', async () => {
    const key = makeKey()
    const { nonce, cookieValue } = freshNonce()
    await expect(verifySiwpLogin(erc4361Credentials(key, makeMessage(key.address, nonce)), options(cookieValue))).resolves.toBe(key.address)
  })

  it('accepts an ADR-36 login (base64 key)', async () => {
    const key = makeKey()
    const { nonce, cookieValue } = freshNonce()
    await expect(verifySiwpLogin(adr36Credentials(key, makeMessage(key.address, nonce)), options(cookieValue))).resolves.toBe(key.address)
  })

  // The mainnet log "Derived address: X vs. Message address: Y" on a successful login: verifyAdr36
  // base64-decodes the public key, so a hex key (ERC-4361 login) derives a garbage address there
  // and that path fails, while verifyERC4361 (hex decode, address check, signature) passes.
  it('explains the mainnet mismatch log: a hex key fails the ADR-36 path with a different derived address, ERC-4361 passes', async () => {
    const key = makeKey()
    const { nonce } = freshNonce()
    const message = makeMessage(key.address, nonce)
    const creds = erc4361Credentials(key, message)

    const adr36 = await message.verifyAdr36({ signature: creds.signature, publicKey: creds.publicKey, domain: DOMAIN }, { suppressExceptions: true })
    const garbageDerived = toBech32('pokt', ripemd160(sha256(Buffer.from(creds.publicKey, 'base64'))))
    expect(adr36.success).toBe(false)
    // The library's own mismatch report: the message address against the address it derived.
    expect(adr36.error).toMatchObject({ expected: key.address, received: garbageDerived })
    expect(garbageDerived).not.toBe(key.address)

    const erc = await message.verifyERC4361({ signature: creds.signature, publicKey: creds.publicKey, domain: DOMAIN }, { suppressExceptions: true })
    expect(erc.success).toBe(true)
  })

  it('refuses a message naming key A signed by key B, in both encodings', async () => {
    const a = makeKey()
    const b = makeKey()
    for (const build of [erc4361Credentials, adr36Credentials]) {
      const { nonce, cookieValue } = freshNonce()
      await expect(verifySiwpLogin(build(b, makeMessage(a.address, nonce)), options(cookieValue))).rejects.toThrow('signature does not verify')
    }
  })

  it("refuses key B's public key presented for key A's address", async () => {
    const a = makeKey()
    const b = makeKey()
    const { nonce, cookieValue } = freshNonce()
    const message = makeMessage(a.address, nonce)
    const creds = { ...erc4361Credentials(a, message), publicKey: b.compressed.toString('hex') }
    await expect(verifySiwpLogin(creds, options(cookieValue))).rejects.toThrow('signature does not verify')
  })

  it('refuses an uncompressed public key: its derived address is not the message address', async () => {
    const key = makeKey()
    const { nonce, cookieValue } = freshNonce()
    const creds = erc4361Credentials(key, makeMessage(key.address, nonce), key.uncompressed)
    await expect(verifySiwpLogin(creds, options(cookieValue))).rejects.toThrow('signature does not verify')
  })

  it('prints nothing to the console while verifying (vault-siwp logs the message and signature otherwise)', async () => {
    const spies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m))
    try {
      const key = makeKey()
      for (const build of [erc4361Credentials, adr36Credentials]) {
        const { nonce, cookieValue } = freshNonce()
        await verifySiwpLogin(build(key, makeMessage(key.address, nonce)), options(cookieValue))
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('verifySiwpLogin replay and freshness rules', () => {
  const key = makeKey()

  it('refuses a nonce the server did not issue (no cookie, or a different nonce)', async () => {
    const { cookieValue } = freshNonce()
    const creds = erc4361Credentials(key, makeMessage(key.address, 'clientnonce1234'))
    await expect(verifySiwpLogin(creds, options(cookieValue))).rejects.toThrow('not issued')
    await expect(verifySiwpLogin(creds, options(''))).rejects.toThrow('not issued')
  })

  it('refuses a forged or expired nonce cookie', async () => {
    const now = Date.now()
    const { nonce, cookieValue } = freshNonce(now - 6 * 60 * 1000)
    const creds = erc4361Credentials(key, makeMessage(key.address, nonce))
    await expect(verifySiwpLogin(creds, options(cookieValue))).rejects.toThrow('not issued')
    const [n, exp] = freshNonce().cookieValue.split('.')
    expect(readLoginNonceCookie(SECRET, `${n}.${exp}.forged`)).toBeNull()
    expect(readLoginNonceCookie('other-secret-other-secret-other!!', freshNonce().cookieValue)).toBeNull()
  })

  it('accepts a nonce only once', async () => {
    const { nonce, cookieValue } = freshNonce()
    const creds = erc4361Credentials(key, makeMessage(key.address, nonce))
    await expect(verifySiwpLogin(creds, options(cookieValue))).resolves.toBe(key.address)
    await expect(verifySiwpLogin(creds, options(cookieValue))).rejects.toThrow('already used')
  })

  it('refuses the wrong chain id', async () => {
    const { nonce, cookieValue } = freshNonce()
    const creds = erc4361Credentials(key, makeMessage(key.address, nonce, { chainId: 'pocket-beta' }))
    await expect(verifySiwpLogin(creds, options(cookieValue))).rejects.toThrow('wrong chain id')
  })

  it.each([
    ['without expirationTime', { expirationTime: undefined }, 'expirationTime is required'],
    ['issued more than 5 minutes ago', { issuedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(), expirationTime: new Date(Date.now() + 60 * 1000).toISOString() }, 'too old'],
    ['issued in the future', { issuedAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), expirationTime: new Date(Date.now() + 9 * 60 * 1000).toISOString() }, 'in the future'],
    ['already expired', { expirationTime: new Date(Date.now() - 1000).toISOString() }, 'expired'],
    ['valid for too long', { expirationTime: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 'too far ahead'],
  ])('refuses a message %s', async (_name, overrides, reason) => {
    const { nonce, cookieValue } = freshNonce()
    const creds = erc4361Credentials(key, makeMessage(key.address, nonce, overrides))
    const error = await verifySiwpLogin(creds, options(cookieValue)).catch((e) => e)
    expect(error).toBeInstanceOf(SiwpLoginError)
    expect(error.message).toContain(reason)
  })
})

describe('cookie helpers', () => {
  it('uses a __Host- name only over https', () => {
    expect(loginNonceCookieName('middleman', true)).toBe('__Host-middleman.login-nonce')
    expect(loginNonceCookieName('middleman', false)).toBe('middleman.login-nonce')
  })

  it('reads one cookie from the request header', () => {
    const request = new Request('https://x', { headers: { cookie: 'a=1; __Host-middleman.login-nonce=abc.1.mac; b=2' } })
    expect(cookieFromRequest(request, '__Host-middleman.login-nonce')).toBe('abc.1.mac')
    expect(cookieFromRequest(request, 'missing')).toBeUndefined()
  })
})
