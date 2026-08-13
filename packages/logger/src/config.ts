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
import {
  getRedactedConsoleSink,
  redactSinkByPattern,
  SECRET_FIELD_PATTERNS,
  SECRET_VALUE_PATTERNS,
} from './redaction'
import { getClientSink, minimalSink } from './client'
import { createContextStorage } from './context-storage'

export interface ConfigureOpts {
  level?: LogLevel
  serviceName?: string
}

// Base fields live in the GLOBAL symbol registry, not module state. Next.js can
// instantiate this package twice on the server (transpilePackages copy for app
// code + dist CJS copy reached via other workspace packages). LogTape itself is
// immune to that (its root logger/config hang off Symbol.for globals), but a
// module-level `let baseFields` is per-copy: configureLogging() in
// instrumentation.ts would populate copy A while @igniter/db's logger reads copy
// B's `{}` — lazy base fields then resolve to undefined and vanish from records.
// Same Symbol.for pattern LogTape uses => one store across all copies.
const BASE_FIELDS_KEY = Symbol.for('igniter.logger.baseFields')
type GlobalWithBaseFields = { [BASE_FIELDS_KEY]?: Record<string, unknown> }

export function detectRuntime(): 'node' | 'edge' | 'browser' {
  // Next.js sets NEXT_RUNTIME='edge' in the edge runtime.
  if (typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined') return 'edge'
  if (process.env.NEXT_RUNTIME === 'edge') return 'edge'
  if (typeof window !== 'undefined') return 'browser'
  return 'node'
}

export function getBaseFields(): Record<string, unknown> {
  return (globalThis as GlobalWithBaseFields)[BASE_FIELDS_KEY] ?? {}
}

function setBaseFields(fields: Record<string, unknown>): void {
  ;(globalThis as GlobalWithBaseFields)[BASE_FIELDS_KEY] = fields
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
 * Resolution history (three bundler failure modes, one per attempt):
 * joined-string dynamic require → Turbopack hard error ("Can't resolve
 * <dynamic>"); eval('require') → Next Edge compile error ("Dynamic Code
 * Evaluation not allowed in Edge Runtime"). Final form: a STATIC import in
 * `./context-storage` (Edge supports AsyncLocalStorage natively) with a
 * package.json `browser`-field substitution so client bundles get a no-op —
 * no dynamic resolution anywhere, every bundler and runtime satisfied.
 *
 * ACCEPTED LIMITATION (PR #322 review, LOW): the substitution rides the legacy
 * top-level `browser` field, not an `exports` condition — `exports` cannot
 * remap this file's INTERNAL relative import, and routing it through a
 * self-referencing subpath doesn't typecheck under this package's classic
 * `moduleResolution: node`. Every bundler in use (webpack, Turbopack) and the
 * mainstream rest (Vite, esbuild, Metro) honor the `browser` field alongside
 * `exports`; a resolver that ignored it would fail the client build LOUDLY on
 * `node:async_hooks`, never silently misbehave.
 */
function loadContextLocalStorage(): ContextLocalStorage<Record<string, unknown>> | undefined {
  try {
    return createContextStorage()
  } catch {
    return undefined
  }
}

export async function configureLogging(opts: ConfigureOpts = {}): Promise<void> {
  const runtime = detectRuntime()
  const isProd = process.env.NODE_ENV === 'production'
  // LOG_FORMAT overrides the NODE_ENV-derived output format: 'json' (NDJSON, the
  // prod/collector/agent-friendly form — localnet sets this) or 'pretty' (human
  // terminal). Unset → json in prod, pretty in dev.
  const logFormat = process.env.LOG_FORMAT
  const useJson = logFormat === 'json' ? true : logFormat === 'pretty' ? false : isProd
  const level: LogLevel = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'debug'

  setBaseFields({
    'service.name': opts.serviceName ?? process.env.SERVICE_NAME ?? 'unknown',
    'service.version': process.env.APP_VERSION ?? 'unknown',
    env: process.env.NODE_ENV ?? 'development',
    runtime,
  })

  if (runtime === 'browser') {
    // dev: pretty console; prod: minimalSink (warn/error/fatal only).
    const browserBase: Sink = isProd
      ? minimalSink
      : getConsoleSink({
          formatter: getPrettyFormatter({ properties: true, inspectOptions: { depth: 4 } }) as TextFormatter,
        })
    await configure({
      reset: true,
      // Same two layers as the node path: redactByField drops secret props, and
      // redactSinkByPattern scrubs value-shaped secrets interpolated into the
      // message — browser sinks have no TextFormatter stage for the library's
      // redactByPattern to wrap, so the record-level wrapper keeps parity.
      sinks: {
        browser: redactByField(redactSinkByPattern(browserBase, SECRET_VALUE_PATTERNS), SECRET_FIELD_PATTERNS),
        client: redactByField(redactSinkByPattern(getClientSink(), SECRET_VALUE_PATTERNS), SECRET_FIELD_PATTERNS),
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
    sinks: { console: getRedactedConsoleSink(useJson) },
    loggers: [
      { category: [], sinks: ['console'], lowestLevel: level },
      // Silence LogTape's own meta logger below warning to avoid noise.
      { category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
    ],
    // ALS is node-only; opt in only where available so edge/browser stay clean.
    ...(runtime === 'node' ? { contextLocalStorage: loadContextLocalStorage() } : {}),
  })
}
