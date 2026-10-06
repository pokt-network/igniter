import { useEffect, useRef } from 'react'
import { useHeightContext } from '../context/Height/height'
import { createBlockRetryBudget } from '../lib/blockRetry'

interface BlockRetryOptions {
  // The part is in error (or missing) and should be fetched again
  shouldRetry: boolean
  // A fetch of the part is running
  isBusy: () => boolean
  run: () => void
  // What the part is fetched for besides the settlement height (e.g. the selected range), so each
  // gets its own budget
  key: string
}

/**
 * Retries a failing part on every new block instead of waiting for the next settlement, at most
 * MAX_BLOCK_RETRIES times in a row per (settlement height, key) (see blockRetry.ts). The budget is
 * restored once the part no longer needs a retry.
 */
export default function useBlockRetry({ shouldRetry, isBusy, run, key }: BlockRetryOptions) {
  const { currentHeight, firstHeight, settlementHeight } = useHeightContext()
  const budgetRef = useRef(createBlockRetryBudget())
  const latestRef = useRef({ shouldRetry, isBusy, run, key, settlementHeight })

  // Declared first, so the retry effect below reads this render's values
  useEffect(() => {
    latestRef.current = { shouldRetry, isBusy, run, key, settlementHeight }
    if (!shouldRetry) budgetRef.current.reset(key)
  })

  useEffect(() => {
    const latest = latestRef.current
    if (!latest.shouldRetry || currentHeight === firstHeight || latest.isBusy()) return
    if (budgetRef.current.take(latest.settlementHeight, latest.key)) latest.run()
  }, [currentHeight, firstHeight])
}
