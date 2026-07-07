import { configure, getLogger, reset, type LogRecord } from '@logtape/logtape'
import {
  getRedactedConsoleSink,
  jsonLinesNumericFormatter,
  redactObject,
  redactStakeSupplierParams,
  redactSupplierServiceConfig,
  SECRET_FIELD_PATTERNS,
} from './redaction'

const SECRET = '[REDACTED]'

describe('redactObject', () => {
  it('redacts every top-level secret field from §7', () => {
    const out = redactObject({
      privateKey: 'pk', signerPrivateKey: 'spk', mnemonic: 'm', seedPhrase: 'sp',
      seed: 's', secretKey: 'sk', password: 'p', token: 't', accessToken: 'a',
      refreshToken: 'r', sessionToken: 'st', apiKey: 'k', secret: 'x',
      authorization: 'Bearer y', signature: 'sig',
      keep: 'visible',
    })
    for (const k of ['privateKey','signerPrivateKey','mnemonic','seedPhrase','seed',
      'secretKey','password','token','accessToken','refreshToken','sessionToken',
      'apiKey','secret','authorization','signature']) {
      expect((out as Record<string, unknown>)[k]).toBe(SECRET)
    }
    expect(out.keep).toBe('visible')
  })

  it('redacts nested, array, and deeply-nested secrets', () => {
    const out = redactObject({
      a: { b: { privateKey: 'pk' } },
      list: [{ password: 'p' }, { ok: 1 }],
    })
    expect(out.a.b.privateKey).toBe(SECRET)
    expect((out.list[0] as Record<string, unknown>).password).toBe(SECRET)
    expect((out.list[1] as Record<string, unknown>).ok).toBe(1)
  })

  it('redacts smtp.pass and cookie/set-cookie', () => {
    const out = redactObject({ smtp: { host: 'h', pass: 'secret' }, cookie: 'c', 'set-cookie': 'sc' })
    expect(out.smtp.pass).toBe(SECRET)
    expect(out.smtp.host).toBe('h')
    expect(out.cookie).toBe(SECRET)
    expect(out['set-cookie']).toBe(SECRET)
  })

  it('redacts publicKey/signature ONLY under credentials.* (publicKey is public elsewhere)', () => {
    const out = redactObject({
      credentials: { publicKey: 'pub', signature: 'sig', address: '0xabc' },
      publicKey: 'top-level-public',
    })
    expect(out.credentials.publicKey).toBe(SECRET)
    expect(out.credentials.signature).toBe(SECRET)
    expect(out.credentials.address).toBe('0xabc')
    expect(out.publicKey).toBe('top-level-public') // NOT globally redacted
  })

  it('matches mixed-case header keys (Authorization, Set-Cookie)', () => {
    const out = redactObject({ Authorization: 'Bearer x', 'Set-Cookie': 'y' })
    expect(out.Authorization).toBe(SECRET)
    expect(out['Set-Cookie']).toBe(SECRET)
  })
})

describe('promoted supplier redactors', () => {
  it('drops signerPrivateKey and projects services', () => {
    const out = redactStakeSupplierParams({
      signerPrivateKey: 'spk',
      ownerAddress: '0xowner',
      services: [{ serviceId: 'svc1', endpoints: [{ url: 'u' }], revShare: [{ address: 'a' }], extra: 'gone' }],
    })
    expect('signerPrivateKey' in out).toBe(false)
    expect(out.ownerAddress).toBe('0xowner')
    expect(out.services[0]).toEqual({ serviceId: 'svc1', endpoints: [{ url: 'u' }], revShare: [{ address: 'a' }] })
  })

  it('projects a single service config to the allow-listed shape', () => {
    expect(redactSupplierServiceConfig({ serviceId: 'svc', endpoints: [1], revShare: [2] }))
      .toEqual({ serviceId: 'svc', endpoints: [1], revShare: [2] })
  })
})

describe('field list', () => {
  it('does NOT globally redact publicKey', () => {
    const matchesPublicKey = SECRET_FIELD_PATTERNS.some((p) =>
      typeof p === 'string' ? p === 'publicKey' : p.test('publicKey'))
    expect(matchesPublicKey).toBe(false)
  })

  // Regression guard: @logtape/redaction's DEFAULT_REDACT_FIELDS includes
  // /key/i + /address/i (and /email/i, /phone/i). It is intentionally NOT
  // spread into SECRET_FIELD_PATTERNS — doing so would globally redact
  // publicKey (violates locked §0) and address/ownerAddress (kills debuggability
  // + breaks the redactObject tests above). Lock that out here.
  it('does NOT globally redact address (DEFAULT_REDACT_FIELDS not spread)', () => {
    const matchesAddress = SECRET_FIELD_PATTERNS.some((p) =>
      typeof p === 'string' ? p === 'address' : p.test('address'))
    expect(matchesAddress).toBe(false)
  })
})

// SINK-level redaction (would have caught the invalid 3rd-arg bug): push a real
// record carrying a secret prop through getRedactedConsoleSink and assert the
// secret never reaches console output. redactByField's array form DELETES the
// matched field (default action), so the key/value is simply absent.
describe('getRedactedConsoleSink', () => {
  const spies: jest.SpyInstance[] = []
  const captured: string[] = []

  beforeEach(() => {
    captured.length = 0
    for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      spies.push(jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(' '))
      }))
    }
  })
  afterEach(async () => {
    for (const s of spies.splice(0)) s.mockRestore()
    await reset()
  })

  it('removes secret props before they reach the console (prod NDJSON)', async () => {
    await configure({
      reset: true,
      sinks: { redacted: getRedactedConsoleSink(true) }, // isProd → numeric NDJSON
      loggers: [{ category: [], sinks: ['redacted'], lowestLevel: 'debug' }],
    })
    getLogger(['t']).info('login attempt', { password: 'SUPER_SECRET_VALUE', keep: 'ok' })
    const out = captured.join('\n')
    expect(out).not.toContain('SUPER_SECRET_VALUE')
    expect(out).not.toContain('password')
    expect(out).toContain('ok')
  })
})

// Numeric level (LOCKED §0): the prod formatter must emit a NUMBER, not a string.
describe('jsonLinesNumericFormatter', () => {
  const rec = (level: LogRecord['level']): LogRecord =>
    ({
      category: ['t'],
      level,
      message: ['hi'],
      rawMessage: 'hi',
      properties: { a: 1 },
      timestamp: Date.parse('2026-06-26T00:00:00.000Z'),
    } as unknown as LogRecord)

  it('maps each level to its numeric code', () => {
    expect(JSON.parse(jsonLinesNumericFormatter(rec('trace'))).level).toBe(10)
    expect(JSON.parse(jsonLinesNumericFormatter(rec('debug'))).level).toBe(20)
    expect(JSON.parse(jsonLinesNumericFormatter(rec('info'))).level).toBe(30)
    expect(JSON.parse(jsonLinesNumericFormatter(rec('warning'))).level).toBe(40)
    expect(JSON.parse(jsonLinesNumericFormatter(rec('error'))).level).toBe(50)
    expect(JSON.parse(jsonLinesNumericFormatter(rec('fatal'))).level).toBe(60)
  })

  it('emits one NDJSON line with rendered message + flattened-properties shape', () => {
    const line = jsonLinesNumericFormatter(rec('info'))
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line)
    expect(parsed.message).toBe('hi')
    expect(parsed.properties).toEqual({ a: 1 })
  })
})
