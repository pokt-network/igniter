import { configureLogging, getLogger } from '@igniter/logger'

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
  await configureLogging({ serviceName: 'middleman' })

  // Refuse to serve with a missing, placeholder or short secret (runs at server start only,
  // never during `next build`). Only the problem is logged, never the value.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { secretProblems } = await import('@igniter/commons/secrets')
    const problems = secretProblems(process.env)
    if (problems.length > 0) {
      getLogger(['middleman', 'startup']).fatal('refusing to start: insecure secrets', { problems })
      // Exit rather than throw: Next.js logs a failed instrumentation hook but keeps the process
      // up, answering every request with 500, which an orchestrator does not see as a crash.
      process.exit(1)
    }
  }
}
