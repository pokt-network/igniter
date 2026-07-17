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

/**
 * Whether a pathname belongs to the authenticated internal areas (app/admin),
 * as opposed to the portal (landing) and auth pages. Single source of truth for
 * the sidebar gate: both the rail (Sidebar) and its toggle (SidebarTriggerGate)
 * must agree, so the prefix set lives here rather than being duplicated.
 */
export const isInternalPath = (pathname: string): boolean =>
  pathname.startsWith('/app') || pathname.startsWith('/admin')
