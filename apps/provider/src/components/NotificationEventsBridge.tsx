'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { Button } from '@igniter/ui/components/button'
import {
  ListUnviewedNotificationEvents,
  MarkNotificationEventsViewed,
} from '@/actions/NotificationChannels'
import type { NotificationEvent } from '@igniter/db/provider/schema'
import { RemediationHistoryEntryReason } from '@igniter/db/provider/enums'
import { NOTIFICATION_EVENT_LABELS, NOTIFICATION_EVENT_SEVERITY } from '@/lib/constants'

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

function eventContent(event: NotificationEvent): string {
  const label = NOTIFICATION_EVENT_LABELS[event.type as keyof typeof NOTIFICATION_EVENT_LABELS] ?? event.type
  const meta = event.metadata

  let detail = ''
  if (meta && 'addresses' in meta) {
    const n = meta.addresses.length
    const noun = `${n} supplier${n !== 1 ? 's' : ''}`
    // Per-type phrasing so the banner reads naturally — "affected" suits an incident,
    // not a successful stake. Falls back to the neutral noun for unmapped types.
    switch (event.type) {
      case 'keys_staked':
        detail = `${noun} finished staking`
        break
      case 'keys_unstaked':
        detail = `${noun} started unstaking`
        break
      case 'supplier_funds_low':
        detail = `${noun} low on operational funds`
        break
      case 'supplier_stake_low':
        detail = `${noun} below the minimum stake`
        break
      default:
        detail = noun
    }
  } else if (meta && 'byReason' in meta) {
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
      detail = okPhrases.join(', ')
    } else {
      // Mixed / failures present — fall back to counts so failures aren't hidden.
      const okTotal = entries.reduce((a, [, r]) => a + r.succeeded.length, 0)
      detail = `${okTotal} succeeded, ${failedTotal} failed`
    }
  } else if (meta && 'inserted' in meta) {
    const changes = meta.inserted + meta.updated + meta.disabled
    detail = `${changes} change${changes !== 1 ? 's' : ''}`
  }

  return detail ? `${label} — ${detail}` : label
}

/**
 * Invisible bridge — loads unviewed notification events and injects them
 * into the existing NotificationsProvider context. Renders nothing.
 */
export default function NotificationEventsBridge() {
  const { addNotification } = useNotifications()
  const router = useRouter()
  const queryClient = useQueryClient()
  const shownIds = useRef<Set<string>>(new Set())

  const { data: events = [] } = useQuery({
    queryKey: ['unviewed-notification-events'],
    queryFn: async () => {
      const result = await ListUnviewedNotificationEvents()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    // Poll often enough that a freshly-created event surfaces in the topbar within a few
    // seconds (60s felt broken). refetchIntervalInBackground keeps polling while this tab
    // is backgrounded — events frequently land while the operator is staking in the
    // middleman tab, so they should already be waiting when they switch back.
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    events.forEach((event, index) => {
      if (shownIds.current.has(event.uuid)) return
      shownIds.current.add(event.uuid)

      addNotification({
        id: event.uuid,
        type: NOTIFICATION_EVENT_SEVERITY[event.type as keyof typeof NOTIFICATION_EVENT_SEVERITY] ?? 'info',
        showTypeIcon: true,
        content: eventContent(event),
        onDismiss: async () => {
          // Dismiss / Dismiss all (and the View action, which removes the toast) must
          // persist by marking the event viewed; otherwise the next poll re-fetches it
          // and the banner reappears after a refresh.
          try {
            await MarkNotificationEventsViewed([event.id])
            queryClient.invalidateQueries({ queryKey: ['unviewed-notification-events'] })
            queryClient.invalidateQueries({ queryKey: ['notification-events'] })
          } catch (err) {
            // Persist failed — drop it from the seen-set so the next poll re-surfaces it
            // instead of silently losing it for the rest of the session.
            shownIds.current.delete(event.uuid)
            console.error('Failed to mark notification event viewed on dismiss', err)
          }
        },
        actions: [
          (_notification, remove) => (
            <Button
              key="view"
              size="sm"
              onClick={() => {
                // remove() runs onDismiss, which already marks viewed + invalidates;
                // just navigate (avoid double-marking / double-invalidating).
                remove()
                router.push(`/admin/notifications?uuid=${event.uuid}`)
              }}
            >
              View
            </Button>
          ),
        ],
      })
    })
  }, [events])

  return null
}
