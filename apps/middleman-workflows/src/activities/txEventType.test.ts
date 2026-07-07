import { txTypeToUserEventType } from './txEventType'
import { TransactionType } from '@igniter/db/middleman/enums'

// Trigger mapping for the stake/unstake/upstake/operational_funds user
// notifications. Shared by the verifier terminal hook and the broadcaster
// failure hook, so both agree on which tx types notify the owner.
describe('txTypeToUserEventType', () => {
  it('maps Stake -> stake', () => {
    expect(txTypeToUserEventType(TransactionType.Stake)).toBe('stake')
  })

  it('maps Unstake -> unstake', () => {
    expect(txTypeToUserEventType(TransactionType.Unstake)).toBe('unstake')
  })

  it('maps Upstake -> upstake', () => {
    expect(txTypeToUserEventType(TransactionType.Upstake)).toBe('upstake')
  })

  it('maps OperationalFunds -> operational_funds', () => {
    expect(txTypeToUserEventType(TransactionType.OperationalFunds)).toBe('operational_funds')
  })

  it('returns undefined for a type with no user-facing event (dispatch skipped)', () => {
    expect(txTypeToUserEventType('SomethingElse' as TransactionType)).toBeUndefined()
  })

  // Guard: if a new TransactionType is added, this fails until its notification
  // mapping is decided — a new tx type must not silently skip the owner notice.
  it('maps every current TransactionType to a defined event', () => {
    for (const type of Object.values(TransactionType)) {
      expect(txTypeToUserEventType(type)).toBeDefined()
    }
  })
})
