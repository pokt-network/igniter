import { SupplierChangeType } from '@igniter/db/middleman/enums'
import { DetectedSupplierChange } from '@igniter/domain/middleman/utils/supplierChanges'

export type SupplierChangeNotification = {
  type: 'service_change' | 'revshare_change'
  ownerIdentity: string
  metadata: { address: string; height: number; detail: string }
}

// Buckets detected supplier changes into the per-owner notifications to fire:
// service add/remove -> one `service_change`, rev-share edits -> one `revshare_change`.
// Each category is kept separate so a notification only describes its own changes.
// Pure so the trigger mapping can be tested without the surrounding activity.
export function buildSupplierChangeNotifications(
  changes: DetectedSupplierChange[],
  ownerIdentity: string,
  meta: { address: string; height: number },
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

  const notifications: SupplierChangeNotification[] = []
  if (serviceChanges.length > 0) {
    notifications.push({
      type: 'service_change',
      ownerIdentity,
      metadata: { ...meta, detail: describe(serviceChanges) },
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
