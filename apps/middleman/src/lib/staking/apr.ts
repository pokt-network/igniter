/**
 * Validator APR, sourced from the Mazarbul analytics endpoint. Delegator income
 * on Pocket comes from claim settlement, which credits accounts directly rather
 * than accruing in the distribution module, so on-chain "pending rewards" is not
 * a usable signal. APR over a trailing window is, and answers the only question
 * the list has to answer: which validator to delegate to.
 */

export const APR_WINDOWS = [7, 30, 90] as const
export type AprWindow = (typeof APR_WINDOWS)[number]

export interface ValidatorApr {
  /** Delegator-facing APR percentage, net of the validator's commission. */
  delegatorAprPct: number
  numDelegators: number
  /** False when the validator has less history than the window covers. */
  fullWindow: boolean
}

/** operator address -> window -> APR */
export type AprByValidator = Record<string, Partial<Record<AprWindow, ValidatorApr>>>

export interface AprSnapshot {
  byValidator: AprByValidator
  /** Network median delegator APR per window, for context next to a validator's own. */
  networkMedianPct: Partial<Record<AprWindow, number>>
}

function isAprWindow(value: unknown): value is AprWindow {
  return APR_WINDOWS.includes(value as AprWindow)
}

export function parseAprResponse(raw: any): AprSnapshot {
  const snapshot: AprSnapshot = { byValidator: {}, networkMedianPct: {} }
  const windows: any[] = raw?.windows ?? []

  for (const w of windows) {
    const days = Number(w?.window_days)
    if (!isAprWindow(days)) continue

    const median = Number(w?.network?.delegator_apr_pct_median)
    if (Number.isFinite(median)) snapshot.networkMedianPct[days] = median

    for (const v of w?.validators ?? []) {
      const address = v?.operator_address
      const apr = Number(v?.delegator_apr_pct)
      if (!address || !Number.isFinite(apr)) continue

      const entry = (snapshot.byValidator[address] ??= {})
      entry[days] = {
        delegatorAprPct: apr,
        numDelegators: Number(v?.num_delegators ?? 0),
        fullWindow: v?.full_window !== false,
      }
    }
  }

  return snapshot
}
