// Consecutive per-block retries allowed while the indexer keeps failing; after that the part
// waits for the next settlement height (which refetches it anyway).
export const MAX_BLOCK_RETRIES = 5

/**
 * The per-block retry budget of one fetched part. `take` says whether a retry may run on this
 * block and counts it; a new settlement height or a successful fetch (`reset`) restores it.
 */
export function createBlockRetryBudget(max = MAX_BLOCK_RETRIES) {
  let used = 0
  let height: unknown

  return {
    take(settlementHeight: unknown): boolean {
      if (settlementHeight !== height) {
        height = settlementHeight
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

export type BlockRetryBudget = ReturnType<typeof createBlockRetryBudget>
