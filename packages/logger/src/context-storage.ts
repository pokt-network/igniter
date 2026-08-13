import { AsyncLocalStorage } from 'node:async_hooks'
import type { ContextLocalStorage } from '@logtape/logtape'

/**
 * Node/Edge implementation of the LogTape context storage.
 *
 * This lives in its own module — with a STATIC `node:async_hooks` import — so
 * every bundler handles it without dynamic-require/eval tricks:
 * - Node runtime: plain CJS import.
 * - Next.js EDGE runtime (middleware): `AsyncLocalStorage` is one of the Node
 *   APIs the Edge runtime explicitly supports, so the static import compiles
 *   and works there (eval/dynamic-require do NOT — Edge forbids dynamic code
 *   evaluation, and Turbopack hard-fails on non-literal `require()`).
 * - Browser bundles: package.json's top-level `browser` field substitutes this
 *   file with `context-storage.browser.ts`'s no-op, so `node:async_hooks`
 *   never reaches a client bundle (webpack and Turbopack both honor it).
 */
export function createContextStorage():
  | ContextLocalStorage<Record<string, unknown>>
  | undefined {
  return new AsyncLocalStorage<Record<string, unknown>>()
}
