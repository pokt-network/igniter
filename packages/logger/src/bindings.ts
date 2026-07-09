/**
 * Correlation field names. snake_case + OTel-compatible so a future tracing
 * initiative drops in without renames. trace_id/span_id are RESERVED and
 * currently unused (spec §0, §5.2).
 */
export const FIELD = {
  REQUEST_ID: 'request_id',
  WORKFLOW_ID: 'workflow_id',
  RUN_ID: 'run_id',
  ACTIVITY_ID: 'activity_id',
  TASK_QUEUE: 'task_queue',
  // reserved, unused:
  TRACE_ID: 'trace_id',
  SPAN_ID: 'span_id',
} as const

/** Inbound/outbound HTTP correlation header (spec §0: standardize on x-request-id). */
export const REQUEST_ID_HEADER = 'x-request-id'

export interface RequestContext {
  request_id: string
  [key: string]: unknown
}
