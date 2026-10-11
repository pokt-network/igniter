/**
 * Chain rejections reach the UI as a raw gateway body: an HTTP status wrapped
 * around a JSON envelope wrapped around an SDK message with a source-file
 * reference. Pull out the part a person can act on.
 */

interface KnownError {
  match: RegExp
  message: string
}

const KNOWN_ERRORS: KnownError[] = [
  {
    match: /redelegation to this validator already in progress/i,
    message:
      'A redelegation to this validator is still maturing. Wait for it to complete, or pick a different destination validator.',
  },
  {
    match: /too many redelegation entries/i,
    message: 'This validator pair has too many redelegations in flight. Wait for an earlier one to mature.',
  },
  {
    match: /insufficient funds|insufficient balance/i,
    message: 'Not enough POKT in this account to cover the amount plus the transaction fee.',
  },
  {
    match: /invalid delegation amount|invalid shares amount/i,
    message: 'That amount is not valid for this delegation. Check the available balance and try a smaller amount.',
  },
  { match: /validator does not exist/i, message: 'That validator no longer exists on chain.' },
  { match: /out of gas/i, message: 'The transaction ran out of gas. Try again.' },
]

/** Extracts the SDK message from a gateway error body, if one is present. */
function extractSdkMessage(raw: string): string | null {
  const jsonStart = raw.indexOf('{')
  if (jsonStart === -1) return null
  try {
    const parsed = JSON.parse(raw.slice(jsonStart))
    const message = parsed?.message
    return typeof message === 'string' ? message : null
  } catch {
    return null
  }
}

/** Drops the `[cosmos/cosmos-sdk@v0.53.7/baseapp/baseapp.go:1052]` style suffix. */
function stripSourceReference(message: string): string {
  return message.replace(/\s*\[[^\]]*@[^\]]*\]\s*/g, ' ').trim()
}

export function humanizeChainError(raw: string): string {
  const sdkMessage = extractSdkMessage(raw)
  const candidate = sdkMessage ?? raw

  for (const { match, message } of KNOWN_ERRORS) {
    if (match.test(candidate)) return message
  }

  const cleaned = stripSourceReference(candidate)
  return cleaned || raw
}
