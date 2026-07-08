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
})
