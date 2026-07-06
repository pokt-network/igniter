// Shared display mapping for middleman notification events — used by the header
// toast bridge (app/app/layout.tsx) and the notification History table so both
// describe an event identically.

export const EVENT_LABELS: Record<string, string> = {
  service_change: 'Supplier service changed',
  revshare_change: 'Revenue share changed',
  stake: 'Stake update',
  unstake: 'Unstake update',
  upstake: 'Upstake update',
  operational_funds: 'Operational funds',
  import_result: 'Supplier import',
}

export const SUPPLIER_TYPES = new Set(['service_change', 'revshare_change'])

export function describeEvent(type: string, meta: Record<string, unknown>): string {
  const outcome = typeof meta.outcome === 'string' ? meta.outcome : ''
  const address = typeof meta.address === 'string' ? meta.address : ''

  if (type === 'service_change' || type === 'revshare_change') {
    const fallback =
      type === 'service_change'
        ? 'A service was added or removed on one of your suppliers.'
        : 'The revenue share on one of your suppliers changed.'
    const detail = typeof meta.detail === 'string' && meta.detail ? meta.detail : fallback
    return address ? `${detail} (${address})` : detail
  }

  if (type === 'import_result') {
    return outcome === 'failed'
      ? `Your supplier import failed. ${meta.error ?? ''}`.trim()
      : `Your supplier import completed${meta.supplierCount != null ? ` (${meta.supplierCount} supplier(s))` : ''}.`
  }

  // stake / unstake / upstake / operational_funds
  const word = outcome === 'failure' ? 'failed' : 'succeeded'
  const label = type === 'operational_funds' ? 'operational funds' : type
  return `Your ${label} transaction ${word}.`
}
