import { configureLogging, getBaseFields, detectRuntime, installBigIntJson } from './config'
import { reset } from '@logtape/logtape'

afterEach(async () => {
  await reset()
})

describe('configureLogging', () => {
  it('serializes bigint without throwing after install', () => {
    installBigIntJson()
    expect(JSON.stringify({ amount: 10n })).toBe('{"amount":"10"}')
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
