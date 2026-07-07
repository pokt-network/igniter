import { SupplierChangeType } from '@igniter/db/middleman/enums'
import { DetectedSupplierChange } from '@igniter/domain/middleman/utils/supplierChanges'

export type SupplierChangeNotification = {
  type: 'service_change' | 'revshare_change'
  ownerIdentity: string
  // `outcome: 'success'` marks a positive event (the supplier's first stake) so
  // the UI renders it green instead of the neutral "config changed" warning.
  // `batchId` links the notification back to the supplier_changes rows so the
  // "View Details" deep-link can highlight/expand that batch.
  metadata: { address: string; height: number; detail: string; outcome?: 'success'; batchId?: string }
}

// Buckets detected supplier changes into the per-owner notifications to fire:
// service add/remove -> one `service_change`, rev-share edits -> one `revshare_change`.
// Each category is kept separate so a notification only describes its own changes.
// Pure so the trigger mapping can be tested without the surrounding activity.
export function buildSupplierChangeNotifications(
  changes: DetectedSupplierChange[],
  ownerIdentity: string,
  meta: { address: string; height: number; batchId?: string },
): SupplierChangeNotification[] {
  const describe = (cs: DetectedSupplierChange[]) =>
    cs.map((c) => c.description).filter(Boolean).join(' ')

  const serviceChanges = changes.filter(
    (c) =>
      c.changeType === SupplierChangeType.ServiceAdded ||
      c.changeType === SupplierChangeType.ServiceRemoved,
  )
  const revShareChanges = changes.filter(
    (c) => c.changeType === SupplierChangeType.RevShareChanged,
  )

  // A service-add flagged `initialStake` is the supplier's first activation — a
  // success, not a config drift. The detector sets it on `newValue.initialStake`.
  const isInitialStake = serviceChanges.some((c) => c.newValue?.initialStake === true)

  const notifications: SupplierChangeNotification[] = []
  if (serviceChanges.length > 0) {
    notifications.push({
      type: 'service_change',
      ownerIdentity,
      metadata: {
        ...meta,
        detail: describe(serviceChanges),
        ...(isInitialStake ? { outcome: 'success' } : {}),
      },
    })
  }
  if (revShareChanges.length > 0) {
    notifications.push({
      type: 'revshare_change',
      ownerIdentity,
      metadata: { ...meta, detail: describe(revShareChanges) },
    })
  }
  return notifications
}
