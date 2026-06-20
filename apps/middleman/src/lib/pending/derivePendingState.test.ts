import { derivePendingState } from './derivePendingState'
import { UNSTAKE_TYPE_URL, STAKE_TYPE_URL } from '@igniter/commons/transactions/extractSuppliers'

const mk = (id: number, typeUrl: string, ops: Array<[string, string]>, type: string) => ({
  id, type, createdAt: new Date(0),
  unsignedPayload: JSON.stringify({ body: { messages: ops.map(([signerOrOwner, op]) =>
    typeUrl === UNSTAKE_TYPE_URL
      ? { typeUrl, value: { signer: signerOrOwner, operatorAddress: op } }
      : { typeUrl, value: { ownerAddress: signerOrOwner, operatorAddress: op, stake: { denom: 'upokt', amount: 1 }, services: [] } }
  ) } }),
})

test('marks unstaking operators + owner', () => {
  const s = derivePendingState([mk(7, UNSTAKE_TYPE_URL, [['pokt1own', 'pokt1op']], 'Unstake')])
  expect(s.byOperator['pokt1op']).toMatchObject({ kind: 'unstake', txId: 7 })
  expect(s.byOwner['pokt1own']).toBe(7)
})

test('collects pending stake operators (no node row needed)', () => {
  const s = derivePendingState([mk(9, STAKE_TYPE_URL, [['pokt1own', 'pokt1opS']], 'Stake')])
  expect(s.pendingStakeOperators).toEqual([
    { operatorAddress: 'pokt1opS', ownerAddress: 'pokt1own', txId: 9, createdAt: new Date(0) },
  ])
  expect(s.byOwner['pokt1own']).toBe(9)
})
