import { derivePendingState } from './derivePendingState'
import { UNSTAKE_TYPE_URL, STAKE_TYPE_URL } from '@igniter/commons/transactions/extractSuppliers'

const mk = (
  id: number,
  typeUrl: string,
  ops: Array<[string, string]>,
  type: string,
  opts: { hash?: string | null; provider?: { name: string } | null; stakeAmount?: number; status?: string } = {},
) => ({
  id, type, createdAt: new Date(0),
  status: opts.status ?? 'pending',
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

test('pendingOperations: stake op carries ownerAddress, stakeAmountUpokt, providerName, hash, status:pending', () => {
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
    status: 'pending',
    operatorAddress: 'pokt1opS',
    ownerAddress: 'pokt1owner',
    stakeAmountUpokt: '5000000',
    providerName: 'MyProvider',
    hash: 'abc123',
    createdAt: new Date(0),
  })
})

test('pendingOperations: unstake op carries ownerAddress (signer), null amount, providerName, hash, status:pending', () => {
  const s = derivePendingState([
    mk(7, UNSTAKE_TYPE_URL, [['pokt1signer', 'pokt1opU']], 'Unstake', {
      hash: 'def456',
      provider: { name: 'ProviderB' },
    }),
  ])
  expect(s.pendingOperations).toHaveLength(1)
  expect(s.pendingOperations[0]).toMatchObject({
    kind: 'unstake',
    status: 'pending',
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

test('settled op: appears in pendingOperations with status:success but NOT in byOperator/byOwner', () => {
  const s = derivePendingState([
    mk(20, UNSTAKE_TYPE_URL, [['pokt1owner', 'pokt1opSettled']], 'Unstake', {
      hash: 'settledHash',
      provider: { name: 'ProviderC' },
      status: 'success',
    }),
  ])
  // Row is visible in pendingOperations (linger)
  expect(s.pendingOperations).toHaveLength(1)
  expect(s.pendingOperations[0]).toMatchObject({
    kind: 'unstake',
    status: 'success',
    operatorAddress: 'pokt1opSettled',
    hash: 'settledHash',
  })
  // But guards are NOT set — settled op must not block actions
  expect(s.byOperator['pokt1opSettled']).toBeUndefined()
  expect(s.byOwner['pokt1owner']).toBeUndefined()
  expect(s.pendingStakeOperators).toHaveLength(0)
})

test('settled op (failure): appears in pendingOperations with status:failure, NOT in guards', () => {
  const s = derivePendingState([
    mk(21, STAKE_TYPE_URL, [['pokt1ownerF', 'pokt1opFail']], 'Stake', {
      hash: 'failHash',
      stakeAmount: 2000000,
      status: 'failure',
    }),
  ])
  expect(s.pendingOperations).toHaveLength(1)
  expect(s.pendingOperations[0]).toMatchObject({
    kind: 'stake',
    status: 'failure',
    operatorAddress: 'pokt1opFail',
    hash: 'failHash',
  })
  expect(s.byOperator['pokt1opFail']).toBeUndefined()
  expect(s.byOwner['pokt1ownerF']).toBeUndefined()
  expect(s.pendingStakeOperators).toHaveLength(0)
})

test('mix: pending op in guards + pendingOperations; settled op only in pendingOperations', () => {
  const s = derivePendingState([
    // pending stake
    mk(30, STAKE_TYPE_URL, [['pokt1ownA', 'pokt1opA']], 'Stake', {
      hash: 'pendingHash',
      stakeAmount: 1000000,
      status: 'pending',
    }),
    // settled unstake (success)
    mk(31, UNSTAKE_TYPE_URL, [['pokt1ownB', 'pokt1opB']], 'Unstake', {
      hash: 'settledHash2',
      status: 'success',
    }),
  ])
  // Both appear in pendingOperations
  expect(s.pendingOperations).toHaveLength(2)
  // Only the pending op is in guards
  expect(s.byOperator['pokt1opA']).toMatchObject({ kind: 'stake', txId: 30 })
  expect(s.byOwner['pokt1ownA']).toBe(30)
  expect(s.pendingStakeOperators).toHaveLength(1)
  expect(s.pendingStakeOperators[0]).toMatchObject({ operatorAddress: 'pokt1opA' })
  // Settled op NOT in guards
  expect(s.byOperator['pokt1opB']).toBeUndefined()
  expect(s.byOwner['pokt1ownB']).toBeUndefined()
})
