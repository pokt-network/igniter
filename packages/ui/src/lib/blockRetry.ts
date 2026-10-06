// Consecutive per-block retries allowed while the indexer keeps failing. After that the part waits
// for a new settlement height or a new key (see useBlockRetry), or for its own refresh: rewards
// refetch on every settlement, and the summary's suppliers on settlement too when missing, plus
// their SUPPLIERS_REFRESH_MS timer.
export const MAX_BLOCK_RETRIES = 5

/**
 * The per-block retry budgets of one component, one per key, all cleared on a new settlement
 * height. `take` says whether a retry of `key` may run on this block and counts it; `reset` (the
 * part no longer needs a retry) restores that key's budget. Switching back to a key whose budget
 * is spent does not refill it.
 */
export function createBlockRetryBudget(max = MAX_BLOCK_RETRIES) {
  let height: number | undefined
  const used = new Map<string, number>()

  return {
    take(settlementHeight: number, key: string): boolean {
      if (settlementHeight !== height) {
        height = settlementHeight
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
