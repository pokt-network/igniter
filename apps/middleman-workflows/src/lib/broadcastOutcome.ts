/**
 * Shared between the `executeTransaction` activity and the ExecuteTransaction workflow.
 *
 * Deliberately a leaf module with NO imports: the workflow file needs the constant at runtime,
 * and Temporal bundles workflow code with webpack into an isolated V8 context. Importing it from
 * the activities module would drag drizzle, pg, node:crypto and node:dns into that bundle and
 * fail worker start-up ("ERROR in node:crypto"). Types can be imported from anywhere; values
 * the workflow uses must come from here or from another Node-free module.
 */

/**
 * `type` of the retryable ApplicationFailure `executeTransaction` throws when a broadcast ends
 * without a definitive answer. The workflow matches on it after the retry policy is exhausted.
 */
export const BROADCAST_OUTCOME_UNKNOWN = 'BroadcastOutcomeUnknown'

/** First (and only) entry of that failure's `details`. */
export type BroadcastOutcomeUnknownDetail = {
  /** Locally derived hash of the bytes sent; absent when the attempt timed out before answering. */
  hash?: string
  code?: number
  codespace?: string
  message?: string
  neverSent: boolean
}
