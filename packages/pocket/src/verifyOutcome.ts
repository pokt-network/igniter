/** Result of a verification query that distinguishes a negative answer from an unreachable RPC. */
export type VerifyOutcome<T> =
  | { status: 'confirmed'; data: T }
  | { status: 'absent'; coveredUpToHeight: number }
  | { status: 'unavailable' }
