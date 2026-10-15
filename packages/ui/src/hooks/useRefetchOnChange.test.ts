// renderHook without a DOM, as useBlockRetry.test.ts: this stands in for React's useRef / useEffect
// (effects run after the render, in declaration order, when their deps change).
const mockHooks = { slots: [] as Array<unknown>, index: 0, effects: [] as Array<() => void> }

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

import useRefetchOnChange from './useRefetchOnChange'

function render(keys: Array<unknown>, refetch: () => void) {
  mockHooks.index = 0
  mockHooks.effects = []
  useRefetchOnChange(keys, refetch)
  mockHooks.effects.forEach((effect) => effect())
}

describe('useRefetchOnChange', () => {
  beforeEach(() => {
    mockHooks.slots = []
  })

  it('does not fetch on mount', () => {
    const refetch = jest.fn()
    render(['100/0', '7d'], refetch)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('fetches once when the rewards epoch and the selected time change in the same commit', () => {
    const refetch = jest.fn()
    render(['100/0', '7d'], refetch)
    render(['120/0', '30d'], refetch)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('fetches once per change of either key, and not on a render with none', () => {
    const refetch = jest.fn()
    render(['100/0', '7d'], refetch)
    render(['100/0', '30d'], refetch)
    render(['100/1', '30d'], refetch)
    render(['100/1', '30d'], refetch)
    expect(refetch).toHaveBeenCalledTimes(2)
  })
})
