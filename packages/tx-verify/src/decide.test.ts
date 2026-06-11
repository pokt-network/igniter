import { decideVerification } from './decide'

const WINDOW = 30
// covered iff coveredUpToHeight >= executionHeight + WINDOW - 1 = 1029
const base = { executionHeight: 1000, expirationWindow: WINDOW }

describe('decideVerification', () => {
  it('confirmed by hash → success', () => {
    const d = decideVerification({
      hash: { status: 'confirmed', data: { success: true, code: 0, gasUsed: 5n } },
      supplier: null,
      ...base,
    })
    expect(d.outcome).toBe('success')
    expect(d.code).toBe(0)
    expect(d.gasUsed).toBe(5n)
  })

  it('confirmed by supplier (hash absent, not yet covered) → success', () => {
    const d = decideVerification({
      hash: { status: 'absent', coveredUpToHeight: 1010 },
      supplier: { status: 'confirmed', data: {} },
      ...base,
    })
    expect(d.outcome).toBe('success')
  })

  it('hash window covered + no supplier effect (answered) → failure', () => {
    const d = decideVerification({
      hash: { status: 'absent', coveredUpToHeight: 1029 },
      supplier: { status: 'absent', coveredUpToHeight: 1029 },
      ...base,
    })
    expect(d.outcome).toBe('failure')
  })

  it('hash window covered, no supplier applicable (send) → failure', () => {
    const d = decideVerification({
      hash: { status: 'absent', coveredUpToHeight: 1029 },
      supplier: null,
      ...base,
    })
    expect(d.outcome).toBe('failure')
  })

  it('hash covered but supplier UNAVAILABLE → pending (incomplete negative evidence)', () => {
    const d = decideVerification({
      hash: { status: 'absent', coveredUpToHeight: 1029 },
      supplier: { status: 'unavailable' },
      ...base,
    })
    expect(d.outcome).toBe('pending')
  })

  it('hash UNAVAILABLE → pending, no counter advance', () => {
    const d = decideVerification({
      hash: { status: 'unavailable' },
      supplier: null,
      ...base,
    })
    expect(d.outcome).toBe('pending')
    expect(d.advanceTxAttempt).toBe(false)
    expect(d.incUnavailable).toBe(true)
  })

  it('hash absent within window → pending, advance coverage + counter', () => {
    const d = decideVerification({
      hash: { status: 'absent', coveredUpToHeight: 1012 },
      supplier: null,
      ...base,
    })
    expect(d.outcome).toBe('pending')
    expect(d.newLastCoveredHeight).toBe(1012)
    expect(d.advanceTxAttempt).toBe(true)
    expect(d.incUnavailable).toBe(false)
  })
})
