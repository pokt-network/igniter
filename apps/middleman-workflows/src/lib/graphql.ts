/**
 * POSTs a query to the indexer GraphQL API and returns its `data`.
 *
 * Throws when the response is not 2xx, is not JSON, or carries `errors`: a query the schema
 * rejects comes back as HTTP 400 with `{errors}` and no `data`, which reading `.data?.` off
 * the body would otherwise turn into a silent null.
 */
export async function postGraphql<T>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  const body = await response.json().catch(() => null) as { data?: T | null; errors?: Array<{ message: string }> } | null
  const errors = body?.errors?.map((e) => e.message).join('; ')

  if (!response.ok || errors || body?.data == null) {
    throw new Error(`Indexer GraphQL request failed with HTTP ${response.status}${errors ? `: ${errors}` : ''}`)
  }

  return body.data
}
