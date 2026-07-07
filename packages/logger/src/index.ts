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

/** UUID for request correlation. NEVER call inside a Temporal workflow sandbox. */
export function newRequestId(): string {
  return crypto.randomUUID()
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
