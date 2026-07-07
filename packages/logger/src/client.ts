import { getConsoleSink, type LogRecord, type Sink } from '@logtape/logtape'

/** A pluggable client (browser) sink. Same shape as any LogTape sink. */
export type ClientSink = Sink

/**
 * GUARD (spec §8 non-goal): the default client sink is a NO-OP. The future
 * client-observability initiative wires a real provider (Sentry/PostHog/Faro)
 * via setClientSink(); #219 MUST NOT wire any real provider here. The seam exists
 * so that wiring later touches zero call sites.
 */
let clientSink: ClientSink = () => {}

export function setClientSink(sink: ClientSink): void {
  clientSink = sink
}

export function getClientSink(): ClientSink {
  return clientSink
}

// LogTape's console sink (library writer; not a raw console call in our source).
const consoleSink: Sink = getConsoleSink()

/**
 * Production browser sink (spec §0 "client shim prod"): only warning/error/fatal
 * reach the browser console; trace/debug/info are intentionally dropped.
 */
export const minimalSink: Sink = (record: LogRecord) => {
  if (
    record.level === 'warning' ||
    record.level === 'error' ||
    record.level === 'fatal'
  ) {
    consoleSink(record)
  }
  // trace/debug/info: no-op in prod browser.
}
