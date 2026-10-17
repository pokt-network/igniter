// Consecutive per-block retries allowed while the indexer keeps failing. After that the part waits
// for a new rewards epoch (a new settlement height or the fallback tick, rewardsEpoch.ts) or a new
// key (see useBlockRetry).
export const MAX_BLOCK_RETRIES = 5

/**
 * The per-block retry budgets of one component, one per key, all cleared on a new epoch (the
 * rewards epoch in useBlockRetry, rewardsEpoch.ts). `take` says whether a retry
 * of `key` may run on this block and counts it; `reset` (the part no longer needs a retry)
 * restores that key's budget. Switching back to a key whose budget
 * is spent does not refill it.
 */
export function createBlockRetryBudget(max = MAX_BLOCK_RETRIES) {
  let current: number | string | undefined
  const used = new Map<string, number>()

  return {
    take(epoch: number | string, key: string): boolean {
      if (epoch !== current) {
        current = epoch
        used.clear()
      }
      const count = used.get(key) ?? 0
      if (count >= max) return false
      used.set(key, count + 1)
      return true
    },
    reset(key: string) {
      used.delete(key)
    },
  }
}
