export const parseEnvInt = function (value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '')
  return Number.isFinite(parsed) ? parsed : fallback
}

export const checkEnvVariables = (vars: string[]) => {
  for (const v of vars) {
    if (!process.env[v]) {
      throw new Error(`Missing required env variable: ${v}`)
    }
  }
}

/**
 * Cosmos SDK registered errors (codespace "sdk"), keyed by ABCI code.
 * Source: cosmos-sdk types/errors/errors.go (codes 2-42).
 *
 * `match` is the exact message string registered for that code (lowercased);
 * `friendly` is the short human-readable text shown in the transaction tables.
 *
 * The friendly text is only used when the raw log actually contains `match`.
 * ABCI codes are only unique within a codespace, and we don't persist the
 * codespace, so a poktroll module error that reuses the same numeric code
 * (e.g. code 5 in the "supplier" codespace) must never be relabeled as the
 * sdk meaning — the log-content check makes that mislabeling impossible.
 */
const COSMOS_SDK_ERRORS: Record<number, { match: string; friendly: string }> = {
  2: { match: 'tx parse error', friendly: 'Transaction could not be decoded' },
  3: { match: 'invalid sequence', friendly: 'Invalid account sequence' },
  4: { match: 'unauthorized', friendly: 'Unauthorized signer or signature' },
  5: { match: 'insufficient funds', friendly: 'Insufficient funds to cover the transaction' },
  6: { match: 'unknown request', friendly: 'Unknown request' },
  7: { match: 'invalid address', friendly: 'Invalid address' },
  8: { match: 'invalid pubkey', friendly: 'Invalid public key' },
  9: { match: 'unknown address', friendly: 'Unknown address' },
  10: { match: 'invalid coins', friendly: 'Invalid coin amount or denomination' },
  11: { match: 'out of gas', friendly: 'Transaction ran out of gas' },
  12: { match: 'memo too large', friendly: 'Transaction memo is too large' },
  13: { match: 'insufficient fee', friendly: 'Fee too low for this transaction' },
  14: { match: 'maximum number of signatures exceeded', friendly: 'Too many signatures' },
  15: { match: 'no signatures supplied', friendly: 'No signatures supplied' },
  16: { match: 'failed to marshal json bytes', friendly: 'Internal encoding error (JSON)' },
  17: { match: 'failed to unmarshal json bytes', friendly: 'Internal decoding error (JSON)' },
  18: { match: 'invalid request', friendly: 'Invalid request' },
  19: { match: 'tx already in mempool', friendly: 'Transaction already pending in the mempool' },
  20: { match: 'mempool is full', friendly: 'Network mempool is full — try again later' },
  21: { match: 'tx too large', friendly: 'Transaction too large' },
  22: { match: 'key not found', friendly: 'Key not found' },
  23: { match: 'invalid account password', friendly: 'Invalid account password' },
  24: { match: 'tx intended signer does not match the given signer', friendly: 'Signer does not match the intended signer' },
  25: { match: 'invalid gas adjustment', friendly: 'Invalid gas adjustment' },
  26: { match: 'invalid height', friendly: 'Invalid block height' },
  27: { match: 'invalid version', friendly: 'Invalid version' },
  28: { match: 'invalid chain-id', friendly: 'Wrong chain ID' },
  29: { match: 'invalid type', friendly: 'Invalid type' },
  30: { match: 'tx timeout height', friendly: 'Transaction expired (timeout height exceeded)' },
  31: { match: 'unknown extension options', friendly: 'Unknown extension options' },
  32: { match: 'incorrect account sequence', friendly: 'Wrong account sequence — transaction sent out of order' },
  33: { match: 'failed packing protobuf message to any', friendly: 'Internal encoding error (protobuf)' },
  34: { match: 'failed unpacking protobuf message from any', friendly: 'Internal decoding error (protobuf)' },
  35: { match: 'internal logic error', friendly: 'Internal logic error' },
  36: { match: 'conflict', friendly: 'Conflict — state changed concurrently' },
  37: { match: 'feature not supported', friendly: 'Feature not supported' },
  38: { match: 'not found', friendly: 'Not found' },
  39: { match: 'internal io error', friendly: 'Internal I/O error' },
  40: { match: 'error in app.toml', friendly: 'Node configuration error' },
  41: { match: 'invalid gas limit', friendly: 'Invalid gas limit' },
  42: { match: 'tx timeout', friendly: 'Transaction timed out before being included in a block' },
}

/**
 * Friendly message for a Cosmos SDK ABCI error, or `null` when the code is
 * unknown or the raw log doesn't corroborate the sdk meaning (see
 * COSMOS_SDK_ERRORS for why corroboration is required).
 */
export const cosmosSdkErrorMessage = (
  code: number | null | undefined,
  rawLog: string | null | undefined,
): string | null => {
  if (code == null || !rawLog) return null
  const entry = COSMOS_SDK_ERRORS[code]
  if (!entry) return null
  return rawLog.toLowerCase().includes(entry.match) ? entry.friendly : null
}

/**
 * Display text for a transaction's failure reason, shared by both apps'
 * transaction tables. Returns `null` when the row is not a failure (the caller
 * renders a placeholder such as "-"). For failures, prefers the friendly
 * Cosmos SDK message when `code` maps to one corroborated by the raw reason;
 * otherwise the trimmed reason, or "Unknown error" when the reason is absent,
 * empty, or whitespace-only.
 */
export const failureReasonDisplay = (
  isFailure: boolean,
  reason: string | null | undefined,
  code?: number | null,
): string | null => {
  if (!isFailure) return null
  return cosmosSdkErrorMessage(code, reason) ?? (reason?.trim() || 'Unknown error')
}

/**
 * Whether a pathname belongs to the authenticated internal areas (app/admin),
 * as opposed to the portal (landing) and auth pages. Single source of truth for
 * the sidebar gate: both the rail (Sidebar) and its toggle (SidebarTriggerGate)
 * must agree, so the prefix set lives here rather than being duplicated.
 */
export const isInternalPath = (pathname: string): boolean =>
  pathname.startsWith('/app') || pathname.startsWith('/admin')
