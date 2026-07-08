import type {
  Logger as TemporalLogger,
  LogLevel,
  LogMetadata,
} from '@temporalio/worker'
import { getLogger, type Logger } from './index'

/** snake_case Temporal correlation meta to match our OTel-compatible fields. */
function normalizeMeta(meta?: LogMetadata): Record<string, unknown> {
  if (!meta) return {}
  const out: Record<string, unknown> = { ...meta }
  const rename: Record<string, string> = {
    workflowId: 'workflow_id',
    runId: 'run_id',
    activityId: 'activity_id',
    taskQueue: 'task_queue',
  }
  for (const [from, to] of Object.entries(rename)) {
    if (from in out) {
      out[to] = out[from]
      delete out[from]
    }
  }
  return out
}

/**
 * LogTape-backed Temporal Logger for Runtime.install({ logger }).
 * Direction: Temporal core/SDK -> our logger. Temporal has no FATAL; the bridge
 * never emits LogTape fatal (reserved for our own process-level failures).
 */
/**
 * Temporal core/SDK messages are FOREIGN free text and routinely contain literal
 * braces (JSON blobs, `Record { ... }` dumps). LogTape treats `{...}` in a message
 * string as a property placeholder, so an unmatched `{foo}` renders as `undefined`
 * and swallows the text. Escape every brace to its doubled form (LogTape's literal
 * escape, verified against @logtape/logtape@2.2.1 parseMessageTemplate: `{{`→`{`,
 * `}}`→`}`) so foreign messages survive verbatim.
 */
function escapeBraces(message: string): string {
  return message.replaceAll('{', '{{').replaceAll('}', '}}')
}

export function getTemporalLogger(category: string | string[] = ['temporal']): TemporalLogger {
  const lt: Logger = getLogger(category)
  const emit = (level: LogLevel, rawMessage: string, meta?: LogMetadata) => {
    const message = escapeBraces(rawMessage)
    const props = normalizeMeta(meta)
    switch (level) {
      case 'TRACE': lt.trace(message, props); break
      case 'DEBUG': lt.debug(message, props); break
      case 'INFO': lt.info(message, props); break
      case 'WARN': lt.warn(message, props); break
      case 'ERROR': lt.error(message, props); break
      default: lt.info(message, props); break
    }
  }
  return {
    trace: (m, meta) => emit('TRACE', m, meta),
    debug: (m, meta) => emit('DEBUG', m, meta),
    info: (m, meta) => emit('INFO', m, meta),
    warn: (m, meta) => emit('WARN', m, meta),
    error: (m, meta) => emit('ERROR', m, meta),
    log: (level: LogLevel, m: string, meta?: LogMetadata) => emit(level, m, meta),
  }
}
