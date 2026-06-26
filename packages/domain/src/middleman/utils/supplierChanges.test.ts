import type { NodeService } from '@igniter/db/middleman/schema'
import { detectSupplierChanges } from './supplierChanges'

const OWNER = 'pokt1owner0000000000000000000000000000000'
const OTHER = 'pokt1other0000000000000000000000000000000'

function svc(
  serviceId: string,
  ownerPct?: number,
  opts: { pendingActivationHeight?: number; otherPct?: number } = {},
): NodeService {
  const revShare: NodeService['revShare'] = []
  if (ownerPct !== undefined) revShare.push({ address: OWNER, revSharePercentage: ownerPct })
  if (opts.otherPct !== undefined) revShare.push({ address: OTHER, revSharePercentage: opts.otherPct })
  return {
    serviceId,
    endpoints: [],
    revShare,
    ...(opts.pendingActivationHeight !== undefined
      ? { pendingActivationHeight: opts.pendingActivationHeight }
      : {}),
  }
}

describe('detectSupplierChanges', () => {
  describe('service added — including the initial-stake lifecycle baseline', () => {
    it('emits service_added for the first-ever services (empty -> populated)', () => {
      // The initial empty→populated transition completes the stake lifecycle (the
      // supplier's services becoming active) and IS surfaced to the owner.
      const changes = detectSupplierChanges([], [svc('svc-a', 100), svc('svc-b', 100)], OWNER)
      expect(changes).toHaveLength(2)
      expect(changes.map((c) => c.changeType)).toEqual(['service_added', 'service_added'])
      expect(changes.map((c) => c.serviceId).sort()).toEqual(['svc-a', 'svc-b'])
    })

    it('emits service_added when a pending service activates (pending -> active)', () => {
      // current filters out the pending entry, so the activation reads as an add.
      const current = [svc('svc-a', 100, { pendingActivationHeight: 500 })]
      const next = [svc('svc-a', 100)] // now active
      const changes = detectSupplierChanges(current, next, OWNER)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ changeType: 'service_added', serviceId: 'svc-a' })
    })

    it('emits service_added when an established node gains another service', () => {
      const current = [svc('svc-a', 100)]
      const next = [svc('svc-a', 100), svc('svc-b', 100)]
      const changes = detectSupplierChanges(current, next, OWNER)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ changeType: 'service_added', serviceId: 'svc-b' })
    })

    it('records the owner rev share on the added service', () => {
      const changes = detectSupplierChanges([], [svc('svc-a', 42)], OWNER)
      expect(changes[0]).toMatchObject({
        changeType: 'service_added',
        serviceId: 'svc-a',
        newValue: { revSharePercentage: 42 },
      })
    })
  })

  describe('service removed / rev share changed', () => {
    it('emits service_removed when the operator drops a service', () => {
      const current = [svc('svc-a', 100), svc('svc-b', 100)]
      const next = [svc('svc-a', 100)]
      const changes = detectSupplierChanges(current, next, OWNER)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ changeType: 'service_removed', serviceId: 'svc-b' })
    })

    it('emits rev_share_changed when the owner rev share changes', () => {
      const current = [svc('svc-a', 50)]
      const next = [svc('svc-a', 70)]
      const changes = detectSupplierChanges(current, next, OWNER)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({
        changeType: 'rev_share_changed',
        serviceId: 'svc-a',
        previousValue: { revSharePercentage: 50 },
        newValue: { revSharePercentage: 70 },
      })
    })
  })

  describe('no-op / non-changes', () => {
    it('emits nothing when active services are identical', () => {
      const services = [svc('svc-a', 100), svc('svc-b', 50)]
      expect(detectSupplierChanges(services, services, OWNER)).toEqual([])
    })

    it('ignores rev share changes for non-owner addresses', () => {
      const current = [svc('svc-a', undefined, { otherPct: 10 })]
      const next = [svc('svc-a', undefined, { otherPct: 90 })]
      expect(detectSupplierChanges(current, next, OWNER)).toEqual([])
    })

    it('treats both-empty inputs as no change', () => {
      expect(detectSupplierChanges([], [], OWNER)).toEqual([])
    })

    it('ignores still-pending services on both sides', () => {
      const current = [svc('svc-a', 100, { pendingActivationHeight: 500 })]
      const next = [svc('svc-a', 100, { pendingActivationHeight: 500 })]
      expect(detectSupplierChanges(current, next, OWNER)).toEqual([])
    })
  })

  describe('initialStake marker (0 -> >=1 active services = stake completed)', () => {
    it('flags initialStake on every service_added when there were no active services before', () => {
      const changes = detectSupplierChanges([], [svc('svc-a', 100), svc('svc-b', 100)], OWNER)
      expect(changes).toHaveLength(2)
      for (const c of changes) {
        expect(c.newValue?.initialStake).toBe(true)
      }
    })

    it('flags initialStake when a pending service activates from no active services', () => {
      const current = [svc('svc-a', 100, { pendingActivationHeight: 500 })] // 0 active
      const next = [svc('svc-a', 100)] // now active
      const changes = detectSupplierChanges(current, next, OWNER)
      expect(changes[0]?.newValue?.initialStake).toBe(true)
    })

    it('does NOT flag initialStake when an already-active node gains another service', () => {
      const current = [svc('svc-a', 100)] // 1 active already
      const next = [svc('svc-a', 100), svc('svc-b', 100)]
      const changes = detectSupplierChanges(current, next, OWNER)
      expect(changes).toHaveLength(1)
      expect(changes[0]?.serviceId).toBe('svc-b')
      expect(changes[0]?.newValue?.initialStake).toBeUndefined()
    })

    it('keeps both the rev share and the initialStake flag on the added service', () => {
      const changes = detectSupplierChanges([], [svc('svc-a', 42)], OWNER)
      expect(changes[0]?.newValue).toEqual({ revSharePercentage: 42, initialStake: true })
    })

    it('marks initialStake even when the owner has no rev share entry', () => {
      const changes = detectSupplierChanges([], [svc('svc-a')], OWNER)
      expect(changes[0]?.newValue).toEqual({ initialStake: true })
    })
  })
})
