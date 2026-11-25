/**
 * Bounded POST to the indexer GraphQL API. Same contract as
 * `postGraphql` from @igniter/graphql/client — returns `data`, throws on non-2xx,
 * non-JSON or `errors` — plus the limits that client leaves to the caller:
 *  - a timeout (AbortSignal), so a stalled indexer cannot pin an activity slot;
 *  - a cap on the response body, so a misbehaving indexer cannot exhaust memory;
 *  - `errors[].message` is NOT copied into the thrown error: activity errors land in
 *    Temporal history and the workflows UI, and indexer error text can echo the query,
 *    variables or upstream internals. Only the HTTP status and the error count are kept.
 */
export const INDEXER_TIMEOUT_MS = 15_000
export const INDEXER_MAX_BODY_BYTES = 2 * 1024 * 1024

async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Indexer GraphQL response too large (HTTP ${response.status})`)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`Indexer GraphQL response too large (HTTP ${response.status})`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function postIndexerGraphql<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  opts: { timeoutMs?: number; maxBodyBytes?: number } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? INDEXER_TIMEOUT_MS),
  })

  const text = await readCappedText(response, opts.maxBodyBytes ?? INDEXER_MAX_BODY_BYTES)
  let body: { data?: T | null; errors?: unknown[] } | null = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  const errorCount = Array.isArray(body?.errors) ? body!.errors!.length : 0

  if (!response.ok || errorCount > 0 || body?.data == null) {
    throw new Error(
      `Indexer GraphQL request failed with HTTP ${response.status}${errorCount ? ` (${errorCount} error${errorCount === 1 ? '' : 's'}, messages redacted)` : ''}`,
    )
  }

  return body.data
}
