import type { ActionResult } from '@igniter/ui/lib/actionResult'

/** A server action's data, or a thrown error for React Query. */
export async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const r = await result
  if (!r.success) throw new Error(r.error.message)
  return r.data
}
