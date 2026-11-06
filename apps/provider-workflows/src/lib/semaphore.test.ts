import { semaphore } from '@/lib/semaphore'

const deferred = () => {
  let resolve: () => void = () => {}
  let reject: (e: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => new Promise((r) => setImmediate(r))

describe('semaphore', () => {
  it('runs at most `slots` calls at once and the waiting ones in arrival order', async () => {
    const run = semaphore(2)
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []
    let inFlight = 0
    let peak = 0
    const calls = gates.map((g, i) => run(async () => {
      started.push(i)
      peak = Math.max(peak, ++inFlight)
      await g.promise
      inFlight--
      return i
    }))
    await flush()
    expect(started).toEqual([0, 1])
    gates[1]!.resolve()
    await flush()
    expect(started).toEqual([0, 1, 2])
    gates[0]!.resolve()
    gates[2]!.resolve()
    gates[3]!.resolve()
    expect(await Promise.all(calls)).toEqual([0, 1, 2, 3])
    expect(peak).toBe(2)
  })

  it('releases the slot of a call that rejects', async () => {
    const run = semaphore(1)
    const failing = deferred()
    const first = run(() => failing.promise)
    const second = run(async () => 'ran')
    failing.reject(new Error('boom'))
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ran')
  })

  it('refuses a slot count that is not a positive integer', () => {
    expect(() => semaphore(0)).toThrow()
    expect(() => semaphore(1.5)).toThrow()
  })
})
