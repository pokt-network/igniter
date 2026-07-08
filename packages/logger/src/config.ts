import {
  configure,
  getConsoleSink,
  type ContextLocalStorage,
  type LogLevel,
  type Sink,
  type TextFormatter,
} from '@logtape/logtape'
import { getPrettyFormatter } from '@logtape/pretty'
import { redactByField } from '@logtape/redaction'
import { getRedactedConsoleSink, SECRET_FIELD_PATTERNS } from './redaction'
import { getClientSink, minimalSink } from './client'

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

export function getBaseFields(): Record<string, unknown> {
  return baseFields
}

/**
 * Lazily resolves Node's `AsyncLocalStorage` (which structurally satisfies
 * LogTape's `ContextLocalStorage` interface) without a static import/require
 * specifier.
 *
 * A literal ESM import of the async-hooks builtin (or a literal `require`
 * call naming it directly) is eagerly resolved by bundlers even when the
 * binding is only *used* inside a `runtime === 'node'` guard: webpack's
 * browser/edge compilation — e.g. for a `'use client'` component that
 * transitively imports this isomorphic module via `@igniter/commons` — has
 * no scheme handler for Node builtin specifiers on that target and
 * hard-fails at build time (`UnhandledSchemeError`). Caught by #219 Task
 * 11's real Next.js/Docker build validation (a plain source grep for the
 * literal specifier does not catch this — only an actual bundler run does).
 *
 * Building the specifier at runtime by joining two strings keeps it out of
 * webpack's static require analysis (it only downgrades to a "the request
 * of a dependency is an expression" warning, same as e.g.
 * `@temporalio/common`'s own dynamic requires), and this function is only
 * ever called from the `runtime === 'node'` branch below, so the `require`
 * call never actually executes in a browser/edge bundle.
 */
function loadContextLocalStorage(): ContextLocalStorage<Record<string, unknown>> | undefined {
  if (typeof require !== 'function') return undefined
  try {
    const specifier = ['node', 'async_hooks'].join(':')
    const { AsyncLocalStorage } = require(specifier) as {
      AsyncLocalStorage: new () => ContextLocalStorage<Record<string, unknown>>
    }
    return new AsyncLocalStorage()
  } catch {
    return undefined
  }
}

export async function configureLogging(opts: ConfigureOpts = {}): Promise<void> {
  const runtime = detectRuntime()
  const isProd = process.env.NODE_ENV === 'production'
  const level: LogLevel = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'debug'

  baseFields = {
    'service.name': opts.serviceName ?? process.env.SERVICE_NAME ?? 'unknown',
    'service.version': process.env.APP_VERSION ?? 'unknown',
    env: process.env.NODE_ENV ?? 'development',
    runtime,
  }

  if (runtime === 'browser') {
    // dev: pretty console; prod: minimalSink (warn/error/fatal only).
    const browserBase: Sink = isProd
      ? minimalSink
      : getConsoleSink({
          formatter: getPrettyFormatter({ properties: true, inspectOptions: { depth: 4 } }) as TextFormatter,
        })
    await configure({
      reset: true,
      // redactByField defensively drops secret props on the client too.
      sinks: {
        browser: redactByField(browserBase, SECRET_FIELD_PATTERNS),
        client: redactByField(getClientSink(), SECRET_FIELD_PATTERNS),
      },
      loggers: [
        { category: [], sinks: ['browser', 'client'], lowestLevel: level },
        { category: ['logtape', 'meta'], sinks: ['browser', 'client'], lowestLevel: 'warning' },
      ],
      // no contextLocalStorage on browser (ALS is node-only)
    })
    return
  }

  // NOTE: LogTape's `Config` has NO top-level `lowestLevel` field (verified against
  // @logtape/logtape@2.2.1 — Config = { sinks, filters?, loggers, contextLocalStorage?,
  // reset? }). The per-logger `lowestLevel` on the root logger `{ category: [], ... }`
  // is what sets the floor. A top-level `lowestLevel` would be a TS excess-property error.
  await configure({
    reset: true,
    sinks: { console: getRedactedConsoleSink(isProd) },
    loggers: [
      { category: [], sinks: ['console'], lowestLevel: level },
      // Silence LogTape's own meta logger below warning to avoid noise.
      { category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
    ],
    // ALS is node-only; opt in only where available so edge/browser stay clean.
    ...(runtime === 'node' ? { contextLocalStorage: loadContextLocalStorage() } : {}),
  })
}
