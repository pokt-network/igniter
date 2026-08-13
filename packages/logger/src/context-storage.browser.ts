import type { ContextLocalStorage } from '@logtape/logtape'

/**
 * Browser substitute for `./context-storage` (wired via package.json's
 * top-level `browser` field). No AsyncLocalStorage on the client — implicit
 * request context is a server concern; returning undefined simply disables
 * `contextLocalStorage` in the browser `configure()` branch.
 */
export function createContextStorage():
  | ContextLocalStorage<Record<string, unknown>>
  | undefined {
  return undefined
}
