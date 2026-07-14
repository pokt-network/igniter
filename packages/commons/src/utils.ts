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
 * Display text for a transaction's failure reason, shared by both apps'
 * transaction tables. Returns `null` when the row is not a failure (the caller
 * renders a placeholder such as "-"); otherwise the trimmed reason, or
 * "Unknown error" when the reason is absent, empty, or whitespace-only.
 */
export const failureReasonDisplay = (
  isFailure: boolean,
  reason: string | null | undefined,
): string | null => {
  if (!isFailure) return null
  return reason?.trim() || 'Unknown error'
}
