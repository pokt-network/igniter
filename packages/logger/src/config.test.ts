import { configureLogging, getBaseFields, detectRuntime } from './config'
import { reset } from '@logtape/logtape'

afterEach(async () => {
  await reset()
})

describe('configureLogging', () => {
  it('does NOT install a global BigInt.prototype.toJSON patch (F11)', async () => {
    // Regression guard: the old installBigIntJson() patched the GLOBAL prototype,
    // which silently changed Temporal payload boundary semantics (bigint crossed
    // as a string instead of throwing loud). bigint is now handled ONLY inside the
    // log formatters, so at global scope JSON.stringify must STILL throw on bigint.
    await configureLogging({ serviceName: 'no-global-patch' })
    expect(() => JSON.stringify({ amount: 10n })).toThrow(TypeError)
    expect((BigInt.prototype as { toJSON?: unknown }).toJSON).toBeUndefined()
  })

  it('exposes base fields with service.version fallback "unknown"', async () => {
    delete process.env.APP_VERSION
    process.env.SERVICE_NAME = 'provider-workflows'
    await configureLogging()
    const base = getBaseFields()
    expect(base['service.name']).toBe('provider-workflows')
    expect(base['service.version']).toBe('unknown')
    expect(base['runtime']).toBe('node')
    expect(base['env']).toBe(process.env.NODE_ENV ?? 'development')
  })

  it('reads service.version from APP_VERSION when set', async () => {
    process.env.APP_VERSION = '1.2.3'
    await configureLogging({ serviceName: 'middleman' })
    expect(getBaseFields()['service.version']).toBe('1.2.3')
  })

  it('detects node runtime in jest', () => {
    expect(detectRuntime()).toBe('node')
  })

  it('LOG_FORMAT=json forces NDJSON output even outside production', async () => {
    const writes: string[] = []
    const spy = jest.spyOn(console, 'info').mockImplementation((line: string) => {
      writes.push(line)
    })
    try {
      process.env.LOG_FORMAT = 'json'
      await configureLogging({ serviceName: 'format-knob-test' })
      const { getLogger } = await import('./index')
      getLogger(['format-test']).info('ndjson check', { a: 1 })
      const line = writes.find((w) => typeof w === 'string' && w.includes('ndjson check'))
      expect(line).toBeDefined()
      const parsed = JSON.parse(line as string)
      expect(parsed.level).toBe(30)
      expect(parsed.properties.a).toBe(1)
    } finally {
      delete process.env.LOG_FORMAT
      spy.mockRestore()
    }
  })
})
