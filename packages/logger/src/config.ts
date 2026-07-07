import { AsyncLocalStorage } from 'node:async_hooks'
import {
  configure,
  getConsoleSink,
  jsonLinesFormatter,
  type LogLevel,
} from '@logtape/logtape'
import { prettyFormatter } from '@logtape/pretty'

export interface ConfigureOpts {
  level?: LogLevel
  serviceName?: string
}

let baseFields: Record<string, unknown> = {}

export function detectRuntime(): 'node' | 'edge' | 'browser' {
  // Next.js sets NEXT_RUNTIME='edge' in the edge runtime.
  if (typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined') return 'edge'
  if (process.env.NEXT_RUNTIME === 'edge') return 'edge'
  if (typeof window !== 'undefined') return 'browser'
  return 'node'
}

/**
 * MANDATORY (spec §0, LOCKED): LogTape's jsonLinesFormatter has no bigint
 * handling, so JSON.stringify throws on bigint. Install a global, idempotent
 * bigint->string replacer via BigInt.prototype.toJSON so every JSON sink
 * (and any JSON.stringify in the process) serializes bigint safely.
 */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string }
  if (typeof proto.toJSON !== 'function') {
    proto.toJSON = function (this: bigint) {
      return this.toString()
    }
  }
}

export function getBaseFields(): Record<string, unknown> {
  return baseFields
}

export async function configureLogging(opts: ConfigureOpts = {}): Promise<void> {
  installBigIntJson()

  const runtime = detectRuntime()
  const isProd = process.env.NODE_ENV === 'production'
  const level: LogLevel = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'debug'

  baseFields = {
    'service.name': opts.serviceName ?? process.env.SERVICE_NAME ?? 'unknown',
    'service.version': process.env.APP_VERSION ?? 'unknown',
    env: process.env.NODE_ENV ?? 'development',
    runtime,
  }

  // Plain console sink for now; Task 4 swaps this for getRedactedConsoleSink(isProd).
  const formatter = isProd ? jsonLinesFormatter : prettyFormatter

  // NOTE: LogTape's `Config` has NO top-level `lowestLevel` field (verified against
  // @logtape/logtape@2.2.1 — Config = { sinks, filters?, loggers, contextLocalStorage?,
  // reset? }). The per-logger `lowestLevel` on the root logger `{ category: [], ... }`
  // is what sets the floor. A top-level `lowestLevel` would be a TS excess-property error.
  await configure({
    reset: true,
    sinks: { console: getConsoleSink({ formatter }) },
    loggers: [
      { category: [], sinks: ['console'], lowestLevel: level },
      // Silence LogTape's own meta logger below warning to avoid noise.
      { category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
    ],
    // ALS is node-only; opt in only where available so edge/browser stay clean.
    ...(runtime === 'node' ? { contextLocalStorage: new AsyncLocalStorage() } : {}),
  })
}
