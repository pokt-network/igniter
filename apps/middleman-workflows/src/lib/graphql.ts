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

/**
 * Like postGraphql, for a document of independent aliases: an error on one alias (the indexer sends
 * the data of the other aliases next to it) comes back keyed by that alias instead of failing the
 * whole answer. A non-2xx answer, an error with no alias, or no data at all still throws.
 */
export async function postGraphqlPartial<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data: Partial<T>; errors: Record<string, string> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  const body = await response.json().catch(() => null) as {
    data?: Partial<T> | null
    errors?: Array<{ message: string; path?: Array<string | number> }>
  } | null
  const errors: Record<string, string> = {}
  const unplaced: Array<string> = []
  for (const e of body?.errors ?? []) {
    const alias = e.path?.[0]
    if (typeof alias === 'string') errors[alias] = errors[alias] ? `${errors[alias]}; ${e.message}` : e.message
    else unplaced.push(e.message)
  }

  if (!response.ok || unplaced.length > 0 || body?.data == null) {
    const messages = [...unplaced, ...Object.values(errors)].join('; ')
    throw new Error(`Indexer GraphQL request failed with HTTP ${response.status}${messages ? `: ${messages}` : ''}`)
  }

  return { data: body.data, errors }
}
