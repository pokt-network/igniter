// Consecutive per-block retries allowed while the indexer keeps failing. After that the part waits
// for a new settlement height or a new key (see useBlockRetry), or for its own refresh: rewards
// refetch on every settlement, and the summary's suppliers on settlement too when missing, plus
// their SUPPLIERS_REFRESH_MS timer.
export const MAX_BLOCK_RETRIES = 5

/**
 * The per-block retry budget of one fetched part, per (settlement height, key). `take` says
 * whether a retry may run on this block and counts it; a new height or key, or `reset` (the part
 * no longer needs a retry), restores it.
 */
export function createBlockRetryBudget(max = MAX_BLOCK_RETRIES) {
  let used = 0
  let budgetKey: string | undefined

  return {
    take(settlementHeight: number, key: string): boolean {
      const nextKey = `${settlementHeight}|${key}`
      if (nextKey !== budgetKey) {
        budgetKey = nextKey
        used = 0
      }
      if (used >= max) return false
      used++
      return true
    },
    reset() {
      used = 0
    },
  }
}
