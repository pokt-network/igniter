import {
  getLogger as ltGetLogger,
  withContext,
  type Logger as LtLogger,
} from '@logtape/logtape'
import { getBaseFields } from './config'
import type { RequestContext } from './bindings'

export type Logger = LtLogger

/**
 * Category-based accessor (LogTape model). No-arg form keeps every existing
 * caller working and returns the root logger. Base fields (service.name,
 * service.version, env, runtime) are bound via .with() so every record carries
 * them once configureLogging() has run.
 */
export function getLogger(category?: string | string[]): Logger {
  const cat = category ?? []
  return ltGetLogger(cat).with(getBaseFields())
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
