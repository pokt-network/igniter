import { buildSupplierChangeNotifications } from './supplierChangeNotifications'
import { SupplierChangeType } from '@igniter/db/middleman/enums'
import type { DetectedSupplierChange } from '@igniter/domain/middleman/utils/supplierChanges'

const OWNER = 'pokt1owner'
const meta = { address: 'pokt1supplier', height: 100 }

function change(changeType: SupplierChangeType, description: string): DetectedSupplierChange {
  return {
    changeType,
    serviceId: 'svc1',
    description,
    previousValue: null,
    newValue: null,
  } as DetectedSupplierChange
}

// Trigger mapping for the service_change / revshare_change user notifications:
// which change categories fire which event, and how the detail is composed.
describe('buildSupplierChangeNotifications', () => {
  it('fires a single service_change for added/removed services', () => {
    const out = buildSupplierChangeNotifications(
      [
        change(SupplierChangeType.ServiceAdded, 'added svc1'),
        change(SupplierChangeType.ServiceRemoved, 'removed svc2'),
      ],
      OWNER,
      meta,
    )
    expect(out).toEqual([
      {
        type: 'service_change',
        ownerIdentity: OWNER,
        metadata: { ...meta, detail: 'added svc1 removed svc2' },
      },
    ])
  })

  it('fires a single revshare_change for rev-share edits', () => {
    const out = buildSupplierChangeNotifications(
      [change(SupplierChangeType.RevShareChanged, 'revshare 10->20')],
      OWNER,
      meta,
    )
    expect(out).toEqual([
      {
        type: 'revshare_change',
        ownerIdentity: OWNER,
        metadata: { ...meta, detail: 'revshare 10->20' },
      },
    ])
  })

  it('fires BOTH when service and rev-share change, each describing only its own category', () => {
    const out = buildSupplierChangeNotifications(
      [
        change(SupplierChangeType.ServiceAdded, 'added svc1'),
        change(SupplierChangeType.RevShareChanged, 'revshare 10->20'),
      ],
      OWNER,
      meta,
    )
    expect(out.map((n) => n.type)).toEqual(['service_change', 'revshare_change'])
    expect(out[0]!.metadata.detail).toBe('added svc1')
    expect(out[1]!.metadata.detail).toBe('revshare 10->20')
  })

  it('fires nothing when there are no changes', () => {
    expect(buildSupplierChangeNotifications([], OWNER, meta)).toEqual([])
  })

  it('marks a first stake (initialStake) as outcome:success', () => {
    const initial = {
      ...change(SupplierChangeType.ServiceAdded, 'initial stake activated'),
      newValue: { initialStake: true },
    } as DetectedSupplierChange
    const out = buildSupplierChangeNotifications([initial], OWNER, meta)
    expect(out[0]!.metadata.outcome).toBe('success')
  })

  it('does NOT mark an ordinary service change as success', () => {
    const out = buildSupplierChangeNotifications(
      [change(SupplierChangeType.ServiceAdded, 'added svc1')],
      OWNER,
      meta,
    )
    expect(out[0]!.metadata.outcome).toBeUndefined()
  })

  it('threads batchId into the notification metadata for the deep-link', () => {
    const out = buildSupplierChangeNotifications(
      [change(SupplierChangeType.ServiceAdded, 'added svc1')],
      OWNER,
      { ...meta, batchId: 'batch-abc' },
    )
    expect(out[0]!.metadata.batchId).toBe('batch-abc')
  })
})
