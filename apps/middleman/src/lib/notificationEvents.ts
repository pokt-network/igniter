// In-app display helpers for middleman notification events — used by the header
// toast bridge (app/app/layout.tsx) and the notification History table. The
// vocabulary (labels, supplier types, fallback text) is the single source in
// @igniter/db so the external message builder (middleman-workflows) can't drift.
import {
  NOTIFICATION_EVENT_LABELS,
  SUPPLIER_EVENT_TYPES,
  NOTIFICATION_EVENT_FALLBACK_DETAIL,
} from '@igniter/db/middleman/schema'

export const EVENT_LABELS: Record<string, string> = NOTIFICATION_EVENT_LABELS

export const SUPPLIER_TYPES = new Set<string>(SUPPLIER_EVENT_TYPES)

export function describeEvent(type: string, meta: Record<string, unknown>): string {
  const outcome = typeof meta.outcome === 'string' ? meta.outcome : ''
  const address = typeof meta.address === 'string' ? meta.address : ''

  if (type === 'service_change' || type === 'revshare_change') {
    const fallback = NOTIFICATION_EVENT_FALLBACK_DETAIL[type] ?? ''
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
