// renderHook for useBlockRetry without a DOM: @igniter/ui has no React test renderer, and adding
// @testing-library/react re-resolves unrelated packages in pnpm-lock.yaml. This stands in for React's
// useRef / useEffect (effects run after the render, in declaration order, when their deps change)
// and for the height context.
const mockHooks = { slots: [] as Array<unknown>, index: 0, effects: [] as Array<() => void> }
let mockHeight = { currentHeight: 10, firstHeight: 10, settlementHeight: 100 }

jest.mock('react', () => ({
  useRef: (initial: unknown) => {
    const i = mockHooks.index++
    if (!(i in mockHooks.slots)) mockHooks.slots[i] = { current: initial }
    return mockHooks.slots[i]
  },
  useEffect: (effect: () => void, deps?: Array<unknown>) => {
    const i = mockHooks.index++
    const prev = mockHooks.slots[i] as Array<unknown> | undefined
    const changed = !deps || !prev || deps.some((d, k) => !Object.is(d, prev[k]))
    mockHooks.slots[i] = deps
    if (changed) mockHooks.effects.push(effect)
  },
}))
jest.mock('../context/Height/height', () => ({ useHeightContext: () => mockHeight }))

import useBlockRetry from './useBlockRetry'
import { MAX_BLOCK_RETRIES } from '../lib/blockRetry'

type Options = Parameters<typeof useBlockRetry>[0]

function renderHook(initial: Options) {
  const render = (options: Options) => {
    mockHooks.index = 0
    mockHooks.effects = []
    useBlockRetry(options)
    mockHooks.effects.forEach((effect) => effect())
  }
  render(initial)
  return { rerender: render }
}

describe('useBlockRetry', () => {
  let run: jest.Mock
  const options = (overrides: Partial<Options> = {}): Options =>
    ({ shouldRetry: true, isBusy: () => false, run, key: 'rewards', ...overrides })
  const blocks = (hook: ReturnType<typeof renderHook>, from: number, to: number, overrides: Partial<Options> = {}) => {
    for (let h = from; h <= to; h++) {
      mockHeight = { ...mockHeight, currentHeight: h }
      hook.rerender(options(overrides))
    }
  }

  beforeEach(() => {
    mockHooks.slots = []
    mockHeight = { currentHeight: 10, firstHeight: 10, settlementHeight: 100 }
    run = jest.fn()
  })

  it('does not run on the first height', () => {
    renderHook(options())
    expect(run).not.toHaveBeenCalled()
  })

  it('runs on new blocks up to the cap, then waits for a new settlement height', () => {
    const hook = renderHook(options())
    blocks(hook, 11, 20)
    expect(run).toHaveBeenCalledTimes(MAX_BLOCK_RETRIES)
    mockHeight = { ...mockHeight, settlementHeight: 120 }
    blocks(hook, 21, 30)
    expect(run).toHaveBeenCalledTimes(2 * MAX_BLOCK_RETRIES)
  })

  it('skips while busy without spending the budget', () => {
    const hook = renderHook(options())
    blocks(hook, 11, 13, { isBusy: () => true })
    expect(run).not.toHaveBeenCalled()
    blocks(hook, 14, 30)
    expect(run).toHaveBeenCalledTimes(MAX_BLOCK_RETRIES)
  })

  it('restores the budget once shouldRetry goes false', () => {
    const hook = renderHook(options())
    blocks(hook, 11, 20)
    expect(run).toHaveBeenCalledTimes(MAX_BLOCK_RETRIES)
    hook.rerender(options({ shouldRetry: false }))
    blocks(hook, 21, 30)
    expect(run).toHaveBeenCalledTimes(2 * MAX_BLOCK_RETRIES)
  })

  it('does not run while shouldRetry is false', () => {
    const hook = renderHook(options({ shouldRetry: false }))
    blocks(hook, 11, 20, { shouldRetry: false })
    expect(run).not.toHaveBeenCalled()
  })
})
