import { createBlockRetryBudget, MAX_BLOCK_RETRIES } from './blockRetry'

describe('createBlockRetryBudget', () => {
  it('allows MAX_BLOCK_RETRIES retries in a row, then waits', () => {
    const budget = createBlockRetryBudget()
    const allowed = Array.from({ length: MAX_BLOCK_RETRIES + 3 }, () => budget.take(100, 'rewards'))
    expect(allowed).toEqual([...Array(MAX_BLOCK_RETRIES).fill(true), false, false, false])
  })

  it('starts over on a new settlement height', () => {
    const budget = createBlockRetryBudget(2)
    expect([budget.take(100, 'rewards'), budget.take(100, 'rewards'), budget.take(100, 'rewards')]).toEqual([true, true, false])
    expect([budget.take(120, 'rewards'), budget.take(120, 'rewards'), budget.take(120, 'rewards')]).toEqual([true, true, false])
  })

  it('gives a new key its own budget', () => {
    const budget = createBlockRetryBudget(2)
    expect([budget.take(100, 'last7d'), budget.take(100, 'last7d'), budget.take(100, 'last7d')]).toEqual([true, true, false])
    expect([budget.take(100, 'last30d'), budget.take(100, 'last30d'), budget.take(100, 'last30d')]).toEqual([true, true, false])
  })

  it('starts over after a success (reset)', () => {
    const budget = createBlockRetryBudget(2)
    budget.take(100, 'rewards')
    budget.take(100, 'rewards')
    budget.reset()
    expect([budget.take(100, 'rewards'), budget.take(100, 'rewards'), budget.take(100, 'rewards')]).toEqual([true, true, false])
  })
})
