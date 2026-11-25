import 'server-only'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { assertPoktAddress } from '@/lib/utils/address'

const ACCOUNT_READ_TIMEOUT_MS = 10_000

const UINT_PATTERN = /^\d+$/

function parseUint(value: unknown, field: string): number {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !UINT_PATTERN.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(`The chain returned no valid ${field} for the account`)
  }
  return Number(text)
}

/**
 * Reads an account's number and sequence from the chain LCD. Throws on any failure (bad address,
 * no API url, timeout, non-2xx, missing or malformed fields): callers that verify a signature with
 * the account number must refuse the request when this throws, never skip the check.
 *
 * Not a server action: GetAccountSequence wraps it with requireAuth for the browser.
 */
export async function fetchChainAccount(address: string): Promise<{ accountNumber: number; sequence: number }> {
  // The address goes into the url path, so only a pokt account address is accepted.
  assertPoktAddress(address)
  const { pocketApiUrl } = await getApplicationSettings()

  if (!pocketApiUrl) {
    throw new Error('API URL not found')
  }

  const res = await fetch(`${pocketApiUrl}/cosmos/auth/v1beta1/accounts/${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(ACCOUNT_READ_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Fetch account sequence failed (${res.status}): ${text || 'no body'}`)
  }

  const data = await res.json()

  return {
    accountNumber: parseUint(data?.account?.account_number, 'account number'),
    sequence: parseUint(data?.account?.sequence, 'sequence'),
  }
}
