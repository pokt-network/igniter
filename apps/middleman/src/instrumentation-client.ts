import { configureLogging } from '@igniter/logger'

// Browser-realm LogTape bootstrap (server/edge use src/instrumentation.ts).
// Next.js 15 auto-loads `src/instrumentation-client.ts` as a plain client
// side-effect module that runs before the app hydrates — no register() export,
// top-level code executes on load. configureLogging detects runtime==='browser'
// and wires the client sinks (dev: pretty console; prod: warn/error-only
// minimalSink). It is async; the top-level void call is fine — sinks are ready
// well before user interactions, and hydration-time client logging is rare.
void configureLogging({ serviceName: 'middleman' })
