import { configureLogging } from '@igniter/logger'

/**
 * Next.js 15 App Router auto-detects `instrumentation.ts` at the `src/` root
 * (no `experimental.instrumentationHook` flag needed) and runs `register()`
 * once, before any other module in this runtime is evaluated. This wires
 * LogTape sinks/base fields as early as possible so no request/log call can
 * race ahead of configuration. serviceName is passed explicitly (same pattern
 * as the workers' bootstrap) so localnet/dev — where the prod image's
 * SERVICE_NAME env is absent — still stamps the right service on records.
 */
export async function register() {
  await configureLogging({ serviceName: 'provider' })
}
