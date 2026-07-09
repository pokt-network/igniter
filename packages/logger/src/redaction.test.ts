import { configure, getLogger, reset, type LogRecord } from '@logtape/logtape'
import { prettyFormatter } from '@logtape/pretty'
import {
  getRedactedConsoleSink,
  jsonLinesNumericFormatter,
  redactObject,
  redactSinkByPattern,
  redactStakeSupplierParams,
  redactSupplierServiceConfig,
  SECRET_FIELD_PATTERNS,
  SECRET_VALUE_PATTERNS,
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

  it('redacts channel + encryption secrets (botToken, webhookUrl, encryptionKey + snake_case)', () => {
    const out = redactObject({
      botToken: 'bt', bot_token: 'bt2',
      webhookUrl: 'https://hooks.example/T/B/x', webhook_url: 'wh2',
      encryptionKey: 'ek', encryption_key: 'ek2',
      url: 'https://public.example', // plain url must survive
    })
    for (const k of ['botToken', 'bot_token', 'webhookUrl', 'webhook_url', 'encryptionKey', 'encryption_key']) {
      expect((out as Record<string, unknown>)[k]).toBe(SECRET)
    }
    expect(out.url).toBe('https://public.example')
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

  // F2 hardening: a self-cyclic object must never leak a reachable reference to
  // the ORIGINAL un-redacted object through the redacted copy. Before the WeakSet
  // visited guard, the cycle would recurse until the depth cap (20) truncation
  // kicked in and return the raw tail of the cycle (structurally = the original
  // object) instead of a redacted copy.
  it('breaks cycles with [circular] instead of leaking the original object', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = { password: 'p', nested: {} }
    a.nested.self = a

    const out = redactObject(a)

    // The cycle spot is replaced with the sentinel, not the raw `a`.
    expect((out.nested as Record<string, unknown>).self).toBe('[circular]')
    // JSON.stringify must not throw (no live cycle survives into the output).
    let json = ''
    expect(() => {
      json = JSON.stringify(out)
    }).not.toThrow()
    // No reachable path carries the un-redacted secret value.
    expect(out.password).toBe(SECRET)
    expect(json).not.toContain('"p"')

    // Walk the whole redacted structure defensively: nothing but the sentinel
    // string or already-redacted values should be reachable from `out`.
    const visited = new Set<unknown>()
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      if (visited.has(node)) return // would only happen if a real cycle remained
      visited.add(node)
      for (const v of Object.values(node as Record<string, unknown>)) {
        expect(v).not.toBe(a) // never re-embeds the original object
        walk(v)
      }
    }
    walk(out)
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

  // Otto#1: redaction patterns must match snake_case field names too — our own
  // Temporal bridge normalizes meta to snake_case, and env/config-derived secrets
  // arrive snake_cased. All these keys must be DELETED before console output.
  it('removes snake_case secret props (private_key, api_key, access_token, signer_private_key)', async () => {
    await configure({
      reset: true,
      sinks: { redacted: getRedactedConsoleSink(true) }, // isProd → numeric NDJSON
      loggers: [{ category: [], sinks: ['redacted'], lowestLevel: 'debug' }],
    })
    getLogger(['t']).info('stake attempt', {
      private_key: 'PK_SECRET',
      api_key: 'AK_SECRET',
      access_token: 'AT_SECRET',
      refresh_token: 'RT_SECRET',
      session_token: 'ST_SECRET',
      signer_private_key: 'SPK_SECRET',
      seed_phrase: 'SEED_SECRET',
      secret_key: 'SK_SECRET',
      set_cookie: 'COOKIE_SECRET',
      keep: 'ok',
    })
    const out = captured.join('\n')
    for (const secret of [
      'PK_SECRET', 'AK_SECRET', 'AT_SECRET', 'RT_SECRET', 'ST_SECRET',
      'SPK_SECRET', 'SEED_SECRET', 'SK_SECRET', 'COOKIE_SECRET',
    ]) {
      expect(out).not.toContain(secret)
    }
    expect(out).toContain('ok')
  })

  // Locked §0: publicKey AND public_key are technically public and must SURVIVE
  // both the camelCase and snake_case redaction paths.
  it('does NOT redact publicKey / public_key (locked §0)', async () => {
    await configure({
      reset: true,
      sinks: { redacted: getRedactedConsoleSink(true) }, // isProd → numeric NDJSON
      loggers: [{ category: [], sinks: ['redacted'], lowestLevel: 'debug' }],
    })
    getLogger(['t']).info('addr', { publicKey: 'PUBCAMEL', public_key: 'PUBSNAKE' })
    const out = captured.join('\n')
    expect(out).toContain('PUBCAMEL')
    expect(out).toContain('PUBSNAKE')
  })

  // F1-lite hardening: secrets interpolated into free MESSAGE text (error strings,
  // template literals) never pass through redactByField (no distinct object prop
  // to delete) — only the pattern backstop on the formatter can catch them.
  it('scrubs password= and Bearer value-shaped secrets from free text without over-redacting look-alikes', async () => {
    await configure({
      reset: true,
      sinks: { redacted: getRedactedConsoleSink(true) }, // isProd → numeric NDJSON
      loggers: [{ category: [], sinks: ['redacted'], lowestLevel: 'debug' }],
    })
    getLogger(['t']).info(
      'login failed: password=hunter2, Authorization: Bearer abc.def, passport=ok',
    )
    const out = captured.join('\n')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('abc.def')
    expect(out).toContain('passport=ok') // non-secret look-alike must survive untouched
  })

  it('scrubs a lowercase "authorization: bearer <tok>" header dump (case-insensitive backstop)', async () => {
    await configure({
      reset: true,
      sinks: { redacted: getRedactedConsoleSink(true) },
      loggers: [{ category: [], sinks: ['redacted'], lowestLevel: 'debug' }],
    })
    getLogger(['t']).info('header dump: authorization: bearer opaque0token9value')
    const out = captured.join('\n')
    expect(out).not.toContain('opaque0token9value')
  })
})

describe('redactSinkByPattern', () => {
  const collect = () => {
    const records: LogRecord[] = []
    const sink = (record: LogRecord) => { records.push(record) }
    return { records, sink }
  }
  const fakeRecord = (message: readonly unknown[], properties: Record<string, unknown> = {}): LogRecord =>
    ({
      category: ['t'],
      level: 'error',
      timestamp: 0,
      message,
      rawMessage: '',
      properties,
    }) as unknown as LogRecord

  it('scrubs value-shaped secrets interpolated into message text parts', () => {
    const { records, sink } = collect()
    redactSinkByPattern(sink, SECRET_VALUE_PATTERNS)(
      fakeRecord(['login failed: password=hunter2 Authorization: Bearer abc.def', undefined]),
    )
    const text = records[0]!.message[0] as string
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('abc.def')
    expect(text).toContain('password=[REDACTED]')
  })

  it('scrubs string property values, including nested ones', () => {
    const { records, sink } = collect()
    redactSinkByPattern(sink, SECRET_VALUE_PATTERNS)(
      fakeRecord(['msg'], { note: 'password=pw1', nested: { dump: 'Bearer tok123' }, n: 42 }),
    )
    expect(records[0]!.properties.note).toBe('password=[REDACTED]')
    expect((records[0]!.properties.nested as Record<string, unknown>).dump).toBe('Bearer [REDACTED]')
    expect(records[0]!.properties.n).toBe(42)
  })

  it('leaves non-secret text and non-string values untouched', () => {
    const { records, sink } = collect()
    const err = new Error('passport=ok')
    redactSinkByPattern(sink, SECRET_VALUE_PATTERNS)(
      fakeRecord(['plain text', 7], { ok: true, err }),
    )
    expect(records[0]!.message[0]).toBe('plain text')
    expect(records[0]!.message[1]).toBe(7)
    expect(records[0]!.properties.ok).toBe(true)
    expect(records[0]!.properties.err).toBe(err) // Errors pass through by reference
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

  // F11: bigint is serialized INSIDE the formatter (bigint->string), NOT via a
  // global BigInt.prototype.toJSON patch. The prod path must emit bigint props
  // as decimal strings without throwing.
  it('serializes a bigint property as a decimal string (scoped, no global patch)', () => {
    const bigRec = {
      category: ['t'],
      level: 'info',
      message: ['stake'],
      rawMessage: 'stake',
      properties: { amount: 10n },
      timestamp: Date.parse('2026-06-26T00:00:00.000Z'),
    } as unknown as LogRecord
    let line = ''
    expect(() => {
      line = jsonLinesNumericFormatter(bigRec)
    }).not.toThrow()
    expect(JSON.parse(line).properties.amount).toBe('10')
    // Proof the fix is formatter-scoped, not global:
    expect(() => JSON.stringify({ amount: 10n })).toThrow(TypeError)
  })

  // F12: a cyclic property must NOT make the record vanish; it must always emit
  // a line with a '[circular]' marker where the cycle was.
  it('emits a line for a record with a cyclic property instead of dropping it', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cyc: any = { name: 'root' }
    cyc.self = cyc
    const cycRec = {
      category: ['t'],
      level: 'error',
      message: ['boom'],
      rawMessage: 'boom',
      properties: { payload: cyc },
      timestamp: Date.parse('2026-06-26T00:00:00.000Z'),
    } as unknown as LogRecord
    let line = ''
    expect(() => {
      line = jsonLinesNumericFormatter(cycRec)
    }).not.toThrow()
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line)
    expect(parsed.message).toBe('boom')
    expect(JSON.stringify(parsed)).toContain('[circular]')
  })
})

// F11: dev/browser pretty path must also survive a bigint property without
// throwing (verified empirically, not assumed).
describe('prettyFormatter bigint safety', () => {
  const bigRec = {
    category: ['t'],
    level: 'info',
    message: ['stake', 10n, ''],
    rawMessage: 'stake {amount}',
    properties: { amount: 10n },
    timestamp: Date.parse('2026-06-26T00:00:00.000Z'),
  } as unknown as LogRecord

  it('does not throw when formatting a bigint property', () => {
    expect(() => prettyFormatter(bigRec)).not.toThrow()
  })
})
