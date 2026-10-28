/**
 * At most `slots` calls of the returned runner are in flight at once; the others wait, in arrival order, for a
 * slot. A slot is released when its call settles, rejected or not.
 */
export function semaphore(slots: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(slots) || slots < 1) throw new Error(`semaphore: slots must be a positive integer, got ${slots}`)
  let free = slots
  const waiting: Array<() => void> = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (free > 0) free--
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await fn()
    } finally {
      // Hand the slot straight to the next waiter, so a newcomer cannot take it first.
      const next = waiting.shift()
      if (next) next()
      else free++
    }
  }
}
