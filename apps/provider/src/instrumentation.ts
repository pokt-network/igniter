import { configureLogging } from '@igniter/logger'

/**
 * Next.js 15 App Router auto-detects `instrumentation.ts` at the `src/` root
 * (no `experimental.instrumentationHook` flag needed) and runs `register()`
 * once, before any other module in this runtime is evaluated. This wires
 * LogTape sinks/base fields as early as possible so no request/log call can
 * race ahead of configuration. `SERVICE_NAME=provider` is set in the
 * Dockerfile (T7), so no explicit arg is needed here.
 */
export async function register() {
  await configureLogging()
}
