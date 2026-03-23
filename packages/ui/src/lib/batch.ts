const SUPPLIER_BATCH_SIZE = 200

/**
 * Split an array into batches to avoid oversized GraphQL requests (413 errors).
 * Returns the original array wrapped in a single-element array if it's small enough.
 */
export function batchArray<T>(items: T[], batchSize = SUPPLIER_BATCH_SIZE): T[][] {
  if (items.length <= batchSize) return [items]

  const batches: T[][] = []
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize))
  }
  return batches
}
