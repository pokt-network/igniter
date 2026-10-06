import { createBlockRetryBudget, MAX_BLOCK_RETRIES } from './blockRetry'

describe('createBlockRetryBudget', () => {
  const takes = (budget: ReturnType<typeof createBlockRetryBudget>, height: number, key: string, n: number) =>
    Array.from({ length: n }, () => budget.take(height, key))

  it('allows MAX_BLOCK_RETRIES retries in a row, then waits', () => {
    expect(takes(createBlockRetryBudget(), 100, 'rewards', MAX_BLOCK_RETRIES + 3))
      .toEqual([...Array(MAX_BLOCK_RETRIES).fill(true), false, false, false])
  })

  it('starts over on a new settlement height', () => {
    const budget = createBlockRetryBudget(2)
    expect(takes(budget, 100, 'rewards', 3)).toEqual([true, true, false])
    expect(takes(budget, 120, 'rewards', 3)).toEqual([true, true, false])
  })

  it('gives each key its own budget, and switching back does not refill a spent one', () => {
    const budget = createBlockRetryBudget(2)
    expect(takes(budget, 100, 'last7d', 3)).toEqual([true, true, false])
    expect(takes(budget, 100, 'last30d', 3)).toEqual([true, true, false])
    expect(takes(budget, 100, 'last7d', 1)).toEqual([false])
  })

  it('restores only the reset key', () => {
    const budget = createBlockRetryBudget(2)
    takes(budget, 100, 'rewards', 2)
    takes(budget, 100, 'suppliers', 2)
    budget.reset('rewards')
    expect(takes(budget, 100, 'rewards', 3)).toEqual([true, true, false])
    expect(takes(budget, 100, 'suppliers', 1)).toEqual([false])
  })
})
