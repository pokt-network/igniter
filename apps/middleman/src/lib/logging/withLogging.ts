import 'server-only'
import { headers } from 'next/headers'
import { REQUEST_ID_HEADER, newRequestId, withRequestContext } from '@igniter/logger'

/**
 * Correlation for Next.js Route Handlers (spec §6). Reads the inbound
 * `x-request-id` propagated by `middleware.ts` (edge -> node continuity) or
 * generates one for routes outside the middleware matcher. Every
 * `getLogger()` call made inside `handler` inherits `request_id` with zero
 * call-site changes.
 */
export function withLogging<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    const requestId = await resolveRequestId()
    return withRequestContext({ request_id: requestId }, () => handler(...args))
  }
}

/**
 * Correlation for server actions ('use server'). Route handlers get wrapped
 * from the outside (`withLogging`); a server action IS the exported function
 * the client calls directly, so it binds its own context at the top of the
 * body instead. Usage: `return runWithRequestContext(() => { ...body... })`.
 */
export async function runWithRequestContext<T>(fn: () => Promise<T> | T): Promise<T> {
  const requestId = await resolveRequestId()
  return withRequestContext({ request_id: requestId }, fn)
}

async function resolveRequestId(): Promise<string> {
  try {
    const inbound = (await headers()).get(REQUEST_ID_HEADER)
    return inbound ?? newRequestId()
  } catch {
    // headers() throws outside a request scope (e.g. a script importing an
    // action module directly) — fall back to a freshly generated id.
    return newRequestId()
  }
}
