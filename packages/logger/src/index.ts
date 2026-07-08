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
 * Node 18 (the CI test pin, 18.20.3) exposes no global `crypto` under jest, so a
 * bare `crypto.randomUUID()` throws `ReferenceError`. Prefer the global Web Crypto
 * when present (browser/edge/Node 20+), otherwise fall back to Node's `crypto`
 * builtin. The specifier is assembled at runtime (same variable-indirection trick
 * as config.ts's `loadContextLocalStorage`) so bundlers targeting browser/edge do
 * NOT statically resolve the node builtin — the `require` only ever runs on Node.
 */
export function newRequestId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const specifier = ['node', 'crypto'].join(':')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require(specifier) as { randomUUID: () => string }).randomUUID()
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
