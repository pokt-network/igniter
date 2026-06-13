import { decideVerification, TX_EXPIRATION_BLOCKS } from './decide'

const confirmedOk = { status: 'confirmed' as const, data: { success: true, code: 0, gasUsed: '100' } }
const confirmedFailed = { status: 'confirmed' as const, data: { success: false, code: 5, gasUsed: '100' } }
const absentAt = (h: number) => ({ status: 'absent' as const, coveredUpToHeight: h })
const unavailable = { status: 'unavailable' as const }
const base = { executionHeight: 1000, expirationWindow: TX_EXPIRATION_BLOCKS, txTimeoutHeight: 1005 as number | null, sequence: null, txTimeoutTimestamp: null, chainTimeAtCoverage: null }

describe('decideVerification v2', () => {
  // D1: on-chain failed tx is a tx-failure, but effects depend on goal-state
  it('hash confirmed success → tx success + apply-success', () => {
    const d = decideVerification({ ...base, hash: confirmedOk, supplier: { status: 'confirmed' } })
    expect(d).toMatchObject({ tx: 'success', effects: 'apply-success', code: 0, gasUsed: '100' })
  })
  it('hash confirmed code!=0, supplier confirmed → tx failure + apply-success (goal met by sibling)', () => {
    const d = decideVerification({ ...base, hash: confirmedFailed, supplier: { status: 'confirmed' } })
    expect(d).toMatchObject({ tx: 'failure', effects: 'apply-success', code: 5 })
  })
  it('hash confirmed code!=0, supplier absent → tx failure + apply-failure', () => {
    const d = decideVerification({ ...base, hash: confirmedFailed, supplier: { status: 'absent', absentOperators: ['pokt1a'] } })
    expect(d).toMatchObject({ tx: 'failure', effects: 'apply-failure', failedOperators: ['pokt1a'] })
  })
  it('hash confirmed code!=0, supplier unavailable → pending (never destructive effects on unknown goal)', () => {
    const d = decideVerification({ ...base, hash: confirmedFailed, supplier: unavailable })
    expect(d).toMatchObject({ tx: 'pending', incUnavailable: true })
  })
  it('hash confirmed code!=0, no supplier path → tx failure + none', () => {
    const d = decideVerification({ ...base, hash: confirmedFailed, supplier: null })
    expect(d).toMatchObject({ tx: 'failure', effects: 'none', code: 5 })
  })

  // goal-state success without hash evidence
  it('supplier confirmed, hash absent → tx success + apply-success, no code/gasUsed', () => {
    const d = decideVerification({ ...base, hash: absentAt(1004), supplier: { status: 'confirmed' } })
    expect(d).toMatchObject({ tx: 'success', effects: 'apply-success' })
    expect(d.code).toBeUndefined()
    expect(d.gasUsed).toBeUndefined()
  })

  // D4: failure soundness — timeoutHeight bound
  it('absent, covered >= timeoutHeight, supplier absent → failure', () => {
    const d = decideVerification({ ...base, hash: absentAt(1005), supplier: { status: 'absent' } })
    expect(d).toMatchObject({ tx: 'failure', effects: 'apply-failure' })
  })
  it('absent, covered < timeoutHeight → pending even if window-end covered', () => {
    const d = decideVerification({ ...base, txTimeoutHeight: 1050, hash: absentAt(1029), supplier: { status: 'absent' } })
    expect(d.tx).toBe('pending')
  })

  // D4: failure soundness — sequence rule (no timeoutHeight)
  it('no timeout, sequence consumed, covered >= observedAtHeight → failure', () => {
    const d = decideVerification({ ...base, txTimeoutHeight: null, sequence: { consumed: true, observedAtHeight: 1040 }, hash: absentAt(1040), supplier: { status: 'absent' } })
    expect(d.tx).toBe('failure')
  })
  it('no timeout, sequence consumed, covered < observedAtHeight → pending (tx may have landed in the gap)', () => {
    const d = decideVerification({ ...base, txTimeoutHeight: null, sequence: { consumed: true, observedAtHeight: 1040 }, hash: absentAt(1029), supplier: { status: 'absent' } })
    expect(d.tx).toBe('pending')
  })
  it('no timeout, sequence not consumed → pending forever (tx can still land)', () => {
    const d = decideVerification({ ...base, txTimeoutHeight: null, sequence: { consumed: false, observedAtHeight: 2000 }, hash: absentAt(1999), supplier: { status: 'absent' } })
    expect(d.tx).toBe('pending')
  })
  it('no timeout, no sequence evidence → pending', () => {
    const d = decideVerification({ ...base, txTimeoutHeight: null, sequence: null, hash: absentAt(5000), supplier: { status: 'absent' } })
    expect(d.tx).toBe('pending')
  })

  // unavailable paths never terminalize
  it('hash unavailable → pending + incUnavailable', () => {
    const d = decideVerification({ ...base, hash: unavailable, supplier: { status: 'absent' } })
    expect(d).toMatchObject({ tx: 'pending', incUnavailable: true })
  })
  it('supplier unavailable blocks failure', () => {
    const d = decideVerification({ ...base, hash: absentAt(1005), supplier: unavailable })
    expect(d).toMatchObject({ tx: 'pending', incUnavailable: true })
  })

  // coverage bookkeeping
  it('pending absent advances newLastCoveredHeight', () => {
    const d = decideVerification({ ...base, txTimeoutHeight: 1050, hash: absentAt(1010), supplier: null })
    expect(d.newLastCoveredHeight).toBe(1010)
  })
})

describe('decideVerification — unordered (timeoutTimestamp) bound', () => {
  const T = new Date('2026-06-13T00:09:00Z') // timeout_timestamp
  const baseU = { executionHeight: 1000, expirationWindow: 12, txTimeoutHeight: null, sequence: null, txTimeoutTimestamp: T }

  it('absent, chain time past timeout, supplier absent → failure', () => {
    const d = decideVerification({ ...baseU, hash: absentAt(1010), chainTimeAtCoverage: new Date('2026-06-13T00:09:01Z'), supplier: { status: 'absent' } })
    expect(d).toMatchObject({ tx: 'failure', effects: 'apply-failure' })
  })
  it('absent, chain time BEFORE timeout → pending (tx can still land)', () => {
    const d = decideVerification({ ...baseU, hash: absentAt(1010), chainTimeAtCoverage: new Date('2026-06-13T00:08:59Z'), supplier: { status: 'absent' } })
    expect(d.tx).toBe('pending')
  })
  it('absent, chainTimeAtCoverage null (RPC could not read block time) → pending, never false-fail', () => {
    const d = decideVerification({ ...baseU, hash: absentAt(1010), chainTimeAtCoverage: null, supplier: { status: 'absent' } })
    expect(d.tx).toBe('pending')
  })
  it('unordered confirmed success unchanged', () => {
    const d = decideVerification({ ...baseU, hash: confirmedOk, chainTimeAtCoverage: T, supplier: { status: 'confirmed' } })
    expect(d).toMatchObject({ tx: 'success', effects: 'apply-success' })
  })
})
