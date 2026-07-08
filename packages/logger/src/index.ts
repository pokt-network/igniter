import {
  getLogger as ltGetLogger,
  lazy,
  withContext,
  type Logger as LtLogger,
} from '@logtape/logtape'
import { getBaseFields } from './config'
import type { RequestContext } from './bindings'

export type Logger = LtLogger

const BASE_KEYS = ['service.name', 'service.version', 'env', 'runtime'] as const

/**
 * Category-based accessor (LogTape model). No-arg form keeps every existing
 * caller working and returns the root logger.
 *
 * Base fields (service.name, service.version, env, runtime) are bound via
 * `lazy()` rather than a plain object. LogTape's `.with()` snapshots plain
 * property values at CALL time, but module-scope loggers (e.g. workers'
 * worker.ts roots, notification channels) are created before
 * `configureLogging()` runs, so a plain snapshot would freeze
 * `getBaseFields()`'s pre-configure value (`{}`) forever. `lazy()` defers
 * evaluation to RECORD time, so these loggers pick up the real base fields
 * once configureLogging() has run, no matter when the logger was created.
 */
export function getLogger(category?: string | string[]): Logger {
  const cat = category ?? []
  return ltGetLogger(cat).with(
    Object.fromEntries(BASE_KEYS.map((k) => [k, lazy(() => getBaseFields()[k])])),
  )
}

/** Correlation: bind ctx to all loggers invoked inside fn (node ALS; no-op on edge). */
export function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return withContext(ctx as Record<string, unknown>, fn)
}

/**
 * UUID for request correlation. NEVER call inside a Temporal workflow sandbox.
 *
 * Prefers the global Web Crypto (browser/edge/Node 20+). Node 18 (the CI test
 * pin, 18.20.3) exposes no global `crypto` under jest, so there is a pure-JS
 * v4-shaped fallback. NO `require` of the node builtin here — even a dynamic
 * specifier is a hard build error under Turbopack ("Can't resolve <dynamic>"),
 * which analyzes every `require()` call site; webpack merely warned. The id is
 * a correlation token, not a security credential, so `Math.random` quality is
 * acceptable on the (CI-only) fallback path.
 */
export function newRequestId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export { configureLogging, type ConfigureOpts } from './config'
export {
  redactObject,
  redactStakeSupplierParams,
  redactSupplierServiceConfig,
  redactSupplierServiceConfigs,
} from './redaction'
export { setClientSink, minimalSink, type ClientSink } from './client'
export { FIELD, REQUEST_ID_HEADER, type RequestContext } from './bindings'
