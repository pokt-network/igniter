import type { Transaction } from '@igniter/db/provider/schema'
import { TransactionStatus, TransactionType } from '@igniter/db/provider/enums'
import { derivePendingState } from './derivePendingState'

// Minimal fixture — derivePendingState only reads type/status/keyAddress/hash/createdAt.
function tx(
  keyAddress: string,
  type: TransactionType,
  status: TransactionStatus,
  createdAt: Date,
  hash: string | null = null,
): Transaction {
  return { keyAddress, type, status, createdAt, hash } as unknown as Transaction
}

const KEY = 'pokt1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const T2 = new Date('2026-06-22T20:00:02Z') // newer
const T1 = new Date('2026-06-22T20:00:01Z') // older

describe('derivePendingState', () => {
  describe('byKey guard (pending-only)', () => {
    it('records a pending op in byKey', () => {
      const { byKey } = derivePendingState([
        tx(KEY, TransactionType.Unstake, TransactionStatus.Pending, T1),
      ])
      expect(byKey[KEY]).toBe('unstake')
    })

    it('does NOT record a settled op in byKey', () => {
      const { byKey } = derivePendingState([
        tx(KEY, TransactionType.Unstake, TransactionStatus.Success, T1),
      ])
      expect(byKey[KEY]).toBeUndefined()
    })
  })

  describe('dedup — one representative op per key (rows arrive newest-first)', () => {
    it('keeps the PENDING op over an older settled op of equal kind-rank', () => {
      // The exact regression the >= bug caused: settled success unstake (older) must NOT
      // overwrite the newer pending return_funds (both rank 2).
      const { pendingOperations } = derivePendingState([
        tx(KEY, TransactionType.ReturnFunds, TransactionStatus.Pending, T2),
        tx(KEY, TransactionType.Unstake, TransactionStatus.Success, T1),
      ])
      expect(pendingOperations).toHaveLength(1)
      expect(pendingOperations[0]).toMatchObject({ kind: 'return_funds', status: 'pending' })
    })

    it('keeps a PENDING op even when a settled op has a higher kind-rank', () => {
      // pending stake (rank 1) vs settled unstake (rank 2): the in-flight op wins.
      const { pendingOperations } = derivePendingState([
        tx(KEY, TransactionType.Stake, TransactionStatus.Pending, T2),
        tx(KEY, TransactionType.Unstake, TransactionStatus.Success, T1),
      ])
      expect(pendingOperations).toHaveLength(1)
      expect(pendingOperations[0]).toMatchObject({ kind: 'stake', status: 'pending' })
    })

    it('keeps the NEWER row on a tie (both settled, same effective priority)', () => {
      const { pendingOperations } = derivePendingState([
        tx(KEY, TransactionType.Unstake, TransactionStatus.Success, T2),
        tx(KEY, TransactionType.Stake, TransactionStatus.Success, T1),
      ])
      expect(pendingOperations).toHaveLength(1)
      expect(pendingOperations[0]).toMatchObject({ kind: 'unstake', status: 'success' })
    })

    it('does not contradict the pending badge: a pending op stays visible alongside its settled predecessor', () => {
      const { byKey, pendingOperations } = derivePendingState([
        tx(KEY, TransactionType.ReturnFunds, TransactionStatus.Pending, T2),
        tx(KEY, TransactionType.Unstake, TransactionStatus.Success, T1),
      ])
      // byKey (pending count) and the displayed op must agree.
      expect(byKey[KEY]).toBe('return_funds')
      expect(pendingOperations[0]?.status).toBe('pending')
    })
  })

  it('carries hash and createdAt through', () => {
    const { pendingOperations } = derivePendingState([
      tx(KEY, TransactionType.Unstake, TransactionStatus.Pending, T1, 'ABC123'),
    ])
    expect(pendingOperations[0]).toMatchObject({ hash: 'ABC123', createdAt: T1 })
  })
})
