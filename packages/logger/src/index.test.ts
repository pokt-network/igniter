import { configure, getLogger as ltGetLogger, reset, type LogRecord } from '@logtape/logtape'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getLogger, withRequestContext, newRequestId } from './index'
import { configureLogging } from './config'

let buffer: LogRecord[]

beforeEach(async () => {
  buffer = []
  await configure({
    reset: true,
    sinks: { buffer: buffer.push.bind(buffer) },
    loggers: [
      { category: [], sinks: ['buffer'], lowestLevel: 'debug' },
      // Verified against installed @logtape/logtape@2.2.1: configure() always emits
      // an info-level "LogTape loggers are configured" meta diagnostic (dist/config.js)
      // that, left unconfigured, inherits the root [] logger's sinks/level and lands in
      // `buffer` ahead of the record(s) under test. Same suppression config.ts's
      // configureLogging() already uses in production (lowestLevel above 'info').
      { category: ['logtape', 'meta'], sinks: ['buffer'], lowestLevel: 'warning' },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  })
})

afterEach(async () => {
  await reset()
})

describe('getLogger', () => {
  it('returns a message-first logger for the no-arg (back-compat) form', () => {
    getLogger().info('hello {who}', { who: 'world' })
    expect(buffer).toHaveLength(1)
    expect(buffer[0]!.properties).toMatchObject({ who: 'world' })
  })

  it('accepts a category array', () => {
    getLogger(['provider', 'auth']).info('x')
    expect(buffer[0]!.category).toEqual(['provider', 'auth'])
  })
})

describe('newRequestId', () => {
  it('generates a uuid-shaped id', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f-]{36}$/i)
  })
})

describe('getLogger base fields (late-bind regression)', () => {
  it('resolves service.name for a logger created BEFORE configureLogging() runs', async () => {
    // Regression for MF-1: module-scope loggers (workers' worker.ts roots,
    // notification channels) call getLogger() at import time, before the
    // app's entrypoint calls configureLogging(). A plain .with(getBaseFields())
    // snapshot would freeze on the pre-configure value ({}) forever. Simulate
    // that ordering here.
    const earlyLogger = getLogger(['worker-root'])

    await configureLogging({ serviceName: 'late-bind-test' })

    // configureLogging() wires its own console sink; redirect back to this
    // test's buffer sink to capture the record. This does not touch
    // config.ts's module-level baseFields, which is the state under test.
    await configure({
      reset: true,
      sinks: { buffer: buffer.push.bind(buffer) },
      loggers: [
        { category: [], sinks: ['buffer'], lowestLevel: 'debug' },
        { category: ['logtape', 'meta'], sinks: ['buffer'], lowestLevel: 'warning' },
      ],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    earlyLogger.info('after late configureLogging')

    expect(buffer).toHaveLength(1)
    expect(buffer[0]!.properties['service.name']).toBe('late-bind-test')
  })
})

describe('withRequestContext', () => {
  it('propagates request_id to records logged inside scope', () => {
    withRequestContext({ request_id: 'req-123' }, () => {
      getLogger(['provider']).info('inside')
    })
    expect(buffer[0]!.properties).toMatchObject({ request_id: 'req-123' })
  })

  it('omits request_id for records logged outside scope', () => {
    getLogger(['provider']).info('outside')
    expect(buffer[0]!.properties.request_id).toBeUndefined()
  })
})
