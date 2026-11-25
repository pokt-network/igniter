/**
 * Reading a provider's reply. Provider urls come from governance, but the reply is still another
 * party's data: redirects are never followed (fetch with PROVIDER_FETCH_INIT), the body is capped
 * and must be JSON.
 */

export const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024

/** Spread into every provider fetch: a 3xx comes back as is, so a provider cannot bounce us elsewhere. */
export const PROVIDER_FETCH_INIT = { redirect: 'manual' } as const satisfies RequestInit

export class ProviderResponseError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'ProviderResponseError'
  }
}

const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i

/** Throws on a redirect (3xx, including the opaque status 0 of a manual redirect). */
export function assertNotRedirect(response: Response): void {
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new ProviderResponseError(`The provider answered a redirect (HTTP ${response.status})`, response.status)
  }
}

/**
 * The reply's JSON body, whatever its status (the caller decides what a 4xx/5xx means). Throws
 * ProviderResponseError on a redirect, a non-JSON content type, a body over `maxBytes`, or invalid JSON.
 */
export async function readProviderJson(response: Response, maxBytes: number = MAX_PROVIDER_RESPONSE_BYTES): Promise<unknown> {
  assertNotRedirect(response)

  const contentType = response.headers.get('content-type') ?? ''
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    await response.body?.cancel().catch(() => undefined)
    throw new ProviderResponseError('The provider reply is not JSON', response.status)
  }

  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new ProviderResponseError('The provider reply is too large', response.status)
  }

  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ProviderResponseError('The provider reply is too large', response.status)
      }
      chunks.push(value)
    }
  }

  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderResponseError('The provider reply is not valid JSON', response.status)
  }
}
