import { EVENT_LABELS, SUPPLIER_TYPES, describeEvent } from './notificationEvents'

describe('EVENT_LABELS', () => {
  it('has a label for all 7 event types', () => {
    expect(Object.keys(EVENT_LABELS).sort()).toEqual([
      'import_result',
      'operational_funds',
      'revshare_change',
      'service_change',
      'stake',
      'unstake',
      'upstake',
    ])
    for (const label of Object.values(EVENT_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('SUPPLIER_TYPES', () => {
  it('contains exactly the two supplier-change types', () => {
    expect([...SUPPLIER_TYPES].sort()).toEqual(['revshare_change', 'service_change'])
  })
})

describe('describeEvent', () => {
  it('service_change uses detail and appends the address', () => {
    expect(describeEvent('service_change', { detail: 'Service X added.', address: 'pokt1abc' })).toBe(
      'Service X added. (pokt1abc)',
    )
  })

  it('service_change falls back when detail is missing', () => {
    expect(describeEvent('service_change', {})).toBe(
      'A service was added or removed on one of your suppliers.',
    )
  })

  it('revshare_change falls back when detail is empty', () => {
    expect(describeEvent('revshare_change', { detail: '' })).toBe(
      'The revenue share on one of your suppliers changed.',
    )
  })

  it('revshare_change without address has no parenthetical', () => {
    expect(describeEvent('revshare_change', { detail: 'Share moved 5% → 10%.' })).toBe(
      'Share moved 5% → 10%.',
    )
  })

  it('import_result completed includes the supplier count', () => {
    expect(describeEvent('import_result', { outcome: 'completed', supplierCount: 3 })).toBe(
      'Your supplier import completed (3 supplier(s)).',
    )
  })

  it('import_result completed without a count omits the parenthetical', () => {
    expect(describeEvent('import_result', { outcome: 'completed' })).toBe(
      'Your supplier import completed.',
    )
  })

  it('import_result failed includes the error', () => {
    expect(describeEvent('import_result', { outcome: 'failed', error: 'boom' })).toBe(
      'Your supplier import failed. boom',
    )
  })

  it('import_result failed without an error stays clean', () => {
    expect(describeEvent('import_result', { outcome: 'failed' })).toBe('Your supplier import failed.')
  })

  it('tx types report success by default', () => {
    expect(describeEvent('stake', {})).toBe('Your stake transaction succeeded.')
    expect(describeEvent('unstake', { outcome: 'success' })).toBe('Your unstake transaction succeeded.')
    expect(describeEvent('upstake', {})).toBe('Your upstake transaction succeeded.')
  })

  it('tx types report failure on outcome=failure', () => {
    expect(describeEvent('stake', { outcome: 'failure' })).toBe('Your stake transaction failed.')
    expect(describeEvent('operational_funds', { outcome: 'failure' })).toBe(
      'Your operational funds transaction failed.',
    )
  })

  it('operational_funds uses the human label', () => {
    expect(describeEvent('operational_funds', {})).toBe(
      'Your operational funds transaction succeeded.',
    )
  })

  it('ignores non-string outcome/address metadata', () => {
    expect(describeEvent('stake', { outcome: 42, address: { a: 1 } })).toBe(
      'Your stake transaction succeeded.',
    )
  })
})
