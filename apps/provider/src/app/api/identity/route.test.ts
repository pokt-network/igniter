import { GET } from './route'

// A throwaway 32-byte secp256k1 private key and the compressed public key it
// derives to. Used only to assert the derivation, never for signing anything.
const PRIVATE_KEY = '0'.repeat(63) + '1'
const EXPECTED_IDENTITY =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

describe('GET /api/identity', () => {
  const originalAppIdentity = process.env.APP_IDENTITY

  afterEach(() => {
    if (originalAppIdentity === undefined) {
      delete process.env.APP_IDENTITY
    } else {
      process.env.APP_IDENTITY = originalAppIdentity
    }
  })

  it('returns the compressed public key derived from APP_IDENTITY', async () => {
    process.env.APP_IDENTITY = PRIVATE_KEY

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ identity: EXPECTED_IDENTITY })
  })

  it('returns a 66-character hex key with a compressed-point prefix', async () => {
    process.env.APP_IDENTITY = PRIVATE_KEY

    const { identity } = await GET().then((r) => r.json())

    // The format the governance registry expects for `identity`.
    expect(identity).toMatch(/^0[23][0-9a-f]{64}$/)
  })

  it('is never cached', async () => {
    process.env.APP_IDENTITY = PRIVATE_KEY

    const response = await GET()

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('fails with 500 when APP_IDENTITY is not set', async () => {
    delete process.env.APP_IDENTITY

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Identity unavailable' })
  })

  it('fails with 500 when APP_IDENTITY is not a valid key', async () => {
    process.env.APP_IDENTITY = 'not-a-hex-private-key'

    const response = await GET()

    expect(response.status).toBe(500)
  })
})
