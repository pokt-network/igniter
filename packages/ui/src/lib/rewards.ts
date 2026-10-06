import { combineBatches, Ranged } from './range'

export type RewardByAddressAndDate = {
  address: string
  date_truncated: string
  total_amount: string | number
}

/**
 * Merge the reward rows of several supplier batches (see batch.ts). Each batch returns its own
 * row per (address, date), so the same pair can appear once per batch; sum them into one row.
 */
export function mergeRewardBatches(rows: Array<RewardByAddressAndDate>): Array<RewardByAddressAndDate> {
  const merged = new Map<string, RewardByAddressAndDate>()

  for (const row of rows) {
    const key = `${row.address}|${row.date_truncated}`
    const existing = merged.get(key)

    if (existing) {
      existing.total_amount = Number(existing.total_amount) + Number(row.total_amount)
    } else {
      merged.set(key, { ...row })
    }
  }

  return Array.from(merged.values())
}

/** The reward totals of several supplier batches, in either indexer shape (see range.ts), summed. */
export function sumRewardTotals(values: Array<unknown>): Ranged<number> {
  return combineBatches(values, (totals) => totals.reduce((sum: number, v) => sum + Number(v), 0))
}

/** The reward rows of several supplier batches, in either indexer shape (see range.ts), merged. */
export function mergeRewardRows(values: Array<unknown>): Ranged<Array<RewardByAddressAndDate>> {
  return combineBatches(values, (batches) =>
    mergeRewardBatches(batches.flatMap((rows) => (Array.isArray(rows) ? rows : []))),
  )
}

export interface RewardsWindows {
  last24h: Ranged<number>
  last48h: Ranged<number>
}

/**
 * The rewardsWindows / nodesSummary documents (legacyRewardsOfAddressesBySuppliersAndTime): the
 * results of every supplier batch, normalised once to one Ranged total per window.
 */
export function combineRewardsWindows(results: Array<{ last24h?: unknown; last48h?: unknown }>): RewardsWindows {
  return {
    last24h: sumRewardTotals(results.map((r) => r.last24h)),
    last48h: sumRewardTotals(results.map((r) => r.last48h)),
  }
}

/**
 * The getRewardsByAddressesAndTimeGroupByAddressAndDate document
 * (legacyRewardsBySuppliersAndTimeGroupByAddressAndDate): the results of every supplier batch,
 * normalised once to one Ranged list of rows.
 */
export function combineRewardRows(results: Array<{ rewards?: unknown }>): Ranged<Array<RewardByAddressAndDate>> {
  return mergeRewardRows(results.map((r) => r.rewards))
}
