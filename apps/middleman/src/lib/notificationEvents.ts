// In-app display helpers for middleman notification events — used by the header
// notification bell (app/components/NotificationBellFeed.tsx) and the notification
// History table. The vocabulary (labels, supplier types, fallback text) is the
// single source in @igniter/db so the external message builder
// (middleman-workflows) can't drift.
import {
  NOTIFICATION_EVENT_LABELS,
  SUPPLIER_EVENT_TYPES,
  NOTIFICATION_EVENT_FALLBACK_DETAIL,
} from '@igniter/db/middleman/schema'

export const EVENT_LABELS: Record<string, string> = NOTIFICATION_EVENT_LABELS

export const SUPPLIER_TYPES = new Set<string>(SUPPLIER_EVENT_TYPES)

// Severity of an event, shared by the bell and the history table so a given
// event is never amber in one place and red in the other. Middleman has no
// per-type severity map: an outcome in the metadata decides it, and a supplier
// config change (no outcome) is a warning because it is drift the delegator did
// not ask for.
export function eventSeverity(
  type: string,
  meta: Record<string, unknown>,
): 'error' | 'warning' | 'info' | 'success' {
  const outcome = typeof meta.outcome === 'string' ? meta.outcome : ''
  if (outcome === 'failure' || outcome === 'failed') return 'error'
  if (outcome === 'success') return 'success'
  return SUPPLIER_TYPES.has(type) ? 'warning' : 'success'
}

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

/** What one bell card shows, derived purely from an event's type + metadata. */
export interface BellCardContent {
  title: string
  description: string
  severity: 'error' | 'warning' | 'info' | 'success'
  /**
   * Deep-link for the card's action button, or undefined when the event has
   * nowhere useful to go. Supplier events land on the batch in Recent Changes.
   */
  href?: string
}

export function bellCardContent(type: string, meta: Record<string, unknown>): BellCardContent {
  const outcome = typeof meta.outcome === 'string' ? meta.outcome : undefined
  const isSupplier = SUPPLIER_TYPES.has(type)
  const batchId = typeof meta.batchId === 'string' ? meta.batchId : undefined

  // A supplier event carrying outcome:'success' (a first stake) is a positive
  // event, not config drift — it gets a dedicated label instead of the
  // drift-flavoured one.
  const title = outcome === 'success' && isSupplier ? 'Stake Completed' : EVENT_LABELS[type] ?? 'Notification'

  return {
    title,
    description: describeEvent(type, meta),
    severity: eventSeverity(type, meta),
    // Fall back to the plain list when a supplier event carries no batch id.
    href: isSupplier ? (batchId ? `/app/suppliers?highlightBatch=${batchId}` : '/app/suppliers') : undefined,
  }
}
