import { derivePendingState } from './derivePendingState'
import { UNSTAKE_TYPE_URL, STAKE_TYPE_URL } from '@igniter/commons/transactions/extractSuppliers'

const mk = (
  id: number,
  typeUrl: string,
  ops: Array<[string, string]>,
  type: string,
  opts: { hash?: string | null; provider?: { name: string } | null; stakeAmount?: number } = {},
) => ({
  id, type, createdAt: new Date(0),
  hash: opts.hash ?? null,
  provider: opts.provider ?? null,
  unsignedPayload: JSON.stringify({ body: { messages: ops.map(([signerOrOwner, op]) =>
    typeUrl === UNSTAKE_TYPE_URL
      ? { typeUrl, value: { signer: signerOrOwner, operatorAddress: op } }
      : { typeUrl, value: { ownerAddress: signerOrOwner, operatorAddress: op, stake: { denom: 'upokt', amount: opts.stakeAmount ?? 1 }, services: [] } }
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

test('pendingOperations: stake op carries ownerAddress, stakeAmountUpokt, providerName, hash', () => {
  const s = derivePendingState([
    mk(9, STAKE_TYPE_URL, [['pokt1owner', 'pokt1opS']], 'Stake', {
      hash: 'abc123',
      provider: { name: 'MyProvider' },
      stakeAmount: 5000000,
    }),
  ])
  expect(s.pendingOperations).toHaveLength(1)
  expect(s.pendingOperations[0]).toMatchObject({
    kind: 'stake',
    operatorAddress: 'pokt1opS',
    ownerAddress: 'pokt1owner',
    stakeAmountUpokt: '5000000',
    providerName: 'MyProvider',
    hash: 'abc123',
    createdAt: new Date(0),
  })
})

test('pendingOperations: unstake op carries ownerAddress (signer), null amount, providerName, hash', () => {
  const s = derivePendingState([
    mk(7, UNSTAKE_TYPE_URL, [['pokt1signer', 'pokt1opU']], 'Unstake', {
      hash: 'def456',
      provider: { name: 'ProviderB' },
    }),
  ])
  expect(s.pendingOperations).toHaveLength(1)
  expect(s.pendingOperations[0]).toMatchObject({
    kind: 'unstake',
    operatorAddress: 'pokt1opU',
    ownerAddress: 'pokt1signer',
    stakeAmountUpokt: null,
    providerName: 'ProviderB',
    hash: 'def456',
    createdAt: new Date(0),
  })
})

test('pendingOperations: deduplication — unstake wins over stake for same operator', () => {
  const s = derivePendingState([
    mk(9, STAKE_TYPE_URL, [['pokt1stakeOwner', 'pokt1op']], 'Stake', {
      hash: 'stakeHash',
      provider: { name: 'ProviderA' },
      stakeAmount: 1000000,
    }),
    mk(10, UNSTAKE_TYPE_URL, [['pokt1unstakeSigner', 'pokt1op']], 'Unstake', {
      hash: 'unstakeHash',
      provider: { name: 'ProviderB' },
    }),
  ])
  // Only one entry for the same operator
  const ops = s.pendingOperations.filter((o) => o.operatorAddress === 'pokt1op')
  expect(ops).toHaveLength(1)
  expect(ops[0]).toMatchObject({
    kind: 'unstake',
    operatorAddress: 'pokt1op',
    ownerAddress: 'pokt1unstakeSigner',
    stakeAmountUpokt: null,
    hash: 'unstakeHash',
  })
})

test('pendingOperations: null hash and null provider are handled gracefully', () => {
  const s = derivePendingState([
    mk(11, STAKE_TYPE_URL, [['pokt1own', 'pokt1opNull']], 'Stake'),
  ])
  expect(s.pendingOperations[0]).toMatchObject({
    hash: null,
    providerName: null,
  })
})
