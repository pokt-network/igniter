// Pure display helpers for the provider notification bell. Kept out of the
// component (`components/NotificationBellFeed.tsx`) so the card wording is unit
// testable without a DOM — the component only maps these onto BellNotification.
import type { NotificationEvent } from '@igniter/db/provider/schema'
import { RemediationHistoryEntryReason } from '@igniter/db/provider/enums'
import { NOTIFICATION_EVENT_LABELS, NOTIFICATION_EVENT_SEVERITY } from '@/lib/constants'

export type BellSeverity = 'error' | 'warning' | 'info' | 'success'

// Human phrasing per remediation reason so "Remediation Complete" reads specifically —
// distinguishing a config-drift fix from a funds/stake top-up, etc.
const REMEDIATION_REASON_PHRASES: Record<string, string> = {
  [RemediationHistoryEntryReason.ServiceMismatch]: 'service config fixed',
  [RemediationHistoryEntryReason.DelegatorAddressMissing]: 'delegator address set',
  [RemediationHistoryEntryReason.OwnerInitialStake]: 'initial stake configured',
  [RemediationHistoryEntryReason.SupplierStakeTooLow]: 'stake topped up',
  [RemediationHistoryEntryReason.SupplierFundsTooLow]: 'operational funds topped up',
  [RemediationHistoryEntryReason.AddressGroupMigration]: 'address group migrated',
}

/** Severity of an event type; the same map the history table tints rows with. */
export function bellSeverity(type: string): BellSeverity {
  return NOTIFICATION_EVENT_SEVERITY[type as keyof typeof NOTIFICATION_EVENT_SEVERITY] ?? 'info'
}

export function eventTitle(event: Pick<NotificationEvent, 'type'>): string {
  return NOTIFICATION_EVENT_LABELS[event.type as keyof typeof NOTIFICATION_EVENT_LABELS] ?? event.type
}

export function eventDetail(event: Pick<NotificationEvent, 'type' | 'metadata'>): string {
  const meta = event.metadata

  if (meta && 'addresses' in meta) {
    const n = meta.addresses.length
    const noun = `${n} supplier${n !== 1 ? 's' : ''}`
    // Per-type phrasing so the card reads naturally — "affected" suits an incident,
    // not a successful stake. Falls back to the neutral noun for unmapped types.
    switch (event.type) {
      case 'keys_staked':
        return `${noun} finished staking`
      case 'keys_unstaked':
        return `${noun} started unstaking`
      case 'supplier_funds_low':
        return `${noun} low on operational funds`
      case 'supplier_stake_low':
        return `${noun} below the minimum stake`
      default:
        return noun
    }
  }

  if (meta && 'byReason' in meta) {
    const entries = Object.entries(meta.byReason).filter(
      ([, r]) => r.succeeded.length + r.failed.length > 0,
    )
    const failedTotal = entries.reduce((a, [, r]) => a + r.failed.length, 0)
    const okPhrases = [
      ...new Set(
        entries
          .filter(([, r]) => r.succeeded.length > 0)
          .map(([reason]) => REMEDIATION_REASON_PHRASES[reason] ?? 'remediated'),
      ),
    ]
    if (failedTotal === 0 && okPhrases.length > 0) {
      // All succeeded — name what was done (e.g. "service config fixed").
      return okPhrases.join(', ')
    }
    // Mixed / failures present — fall back to counts so failures aren't hidden.
    const okTotal = entries.reduce((a, [, r]) => a + r.succeeded.length, 0)
    return `${okTotal} succeeded, ${failedTotal} failed`
  }

  if (meta && 'inserted' in meta) {
    const changes = meta.inserted + meta.updated + meta.disabled
    return `${changes} change${changes !== 1 ? 's' : ''}`
  }

  return ''
}
