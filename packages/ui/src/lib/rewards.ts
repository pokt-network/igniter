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
