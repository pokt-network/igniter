import type { NodeService } from '@igniter/db/middleman/schema'

export type DetectedSupplierChange = {
  changeType: 'service_added' | 'service_removed' | 'rev_share_changed'
  serviceId: string
  description: string
  previousValue: { revSharePercentage: number } | null
  newValue: { revSharePercentage: number } | null
}

function getOwnerRevShare(service: NodeService, ownerAddress: string): number | undefined {
  const entries = service.revShare.filter(
    (rs) => rs.address.toLowerCase() === ownerAddress.toLowerCase(),
  )
  if (entries.length === 0) return undefined
  return entries.reduce((sum: number, rs: { revSharePercentage: number }) => sum + rs.revSharePercentage, 0)
}

/**
 * Detects changes between the current and new services for a supplier.
 * Only compares active services (filters out pending ones).
 * Only tracks: service added, service removed, and rev share change for the owner address.
 */
export function detectSupplierChanges(
  currentServices: NodeService[],
  newServices: NodeService[],
  ownerAddress: string,
): DetectedSupplierChange[] {
  const current = (currentServices ?? []).filter((s) => !s.pendingActivationHeight)
  const next = (newServices ?? []).filter((s) => !s.pendingActivationHeight)

  const currentByServiceId = new Map(current.map((s) => [s.serviceId, s]))
  const nextByServiceId = new Map(next.map((s) => [s.serviceId, s]))

  const changes: DetectedSupplierChange[] = []

  // Services removed
  for (const [serviceId, service] of currentByServiceId) {
    if (!nextByServiceId.has(serviceId)) {
      const ownerPct = getOwnerRevShare(service, ownerAddress)
      changes.push({
        changeType: 'service_removed',
        serviceId,
        description: ownerPct !== undefined
          ? `Service ${serviceId} removed (your rev share was ${ownerPct}%)`
          : `Service ${serviceId} removed`,
        previousValue: ownerPct !== undefined ? { revSharePercentage: ownerPct } : null,
        newValue: null,
      })
    }
  }

  // Services added
  for (const [serviceId, service] of nextByServiceId) {
    if (!currentByServiceId.has(serviceId)) {
      const ownerPct = getOwnerRevShare(service, ownerAddress)
      changes.push({
        changeType: 'service_added',
        serviceId,
        description: ownerPct !== undefined
          ? `Service ${serviceId} added (your rev share is ${ownerPct}%)`
          : `Service ${serviceId} added`,
        previousValue: null,
        newValue: ownerPct !== undefined ? { revSharePercentage: ownerPct } : null,
      })
    }
  }

  // Rev share changed for owner address
  for (const [serviceId, nextService] of nextByServiceId) {
    const currentService = currentByServiceId.get(serviceId)
    if (!currentService) continue

    const currentRevShare = getOwnerRevShare(currentService, ownerAddress)
    const nextRevShare = getOwnerRevShare(nextService, ownerAddress)

    if (currentRevShare === nextRevShare) continue
    // Both undefined means no rev share entry for owner in either — not a change
    if (currentRevShare === undefined && nextRevShare === undefined) continue

    changes.push({
      changeType: 'rev_share_changed',
      serviceId,
      description: `Your rev share for ${serviceId} changed from ${currentRevShare ?? 0}% to ${nextRevShare ?? 0}%`,
      previousValue: { revSharePercentage: currentRevShare ?? 0 },
      newValue: { revSharePercentage: nextRevShare ?? 0 },
    })
  }

  return changes
}
