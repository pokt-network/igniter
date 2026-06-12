/** Result of a verification query that distinguishes a negative answer from an unreachable RPC. */
export type VerifyOutcome<T> =
  | { status: 'confirmed'; data: T }
  | { status: 'absent'; coveredUpToHeight: number }
  | { status: 'unavailable' }

/** Aggregated supplier-path outcome. `absentOperators` lets failure effects act only on operators with negative evidence. */
export type SupplierPathOutcome =
  | { status: 'confirmed' }
  | { status: 'absent'; absentOperators?: string[] }
  | { status: 'unavailable' }
