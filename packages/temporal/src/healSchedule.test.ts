import { healSchedule, defaultHealState } from '@/scheduleWatchdog'
import type { HealState, WatchdogConfig, WatchdogEntry, WatchdogStateStore } from '@/scheduleWatchdog'

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never
const NOW = new Date('2026-07-01T12:00:00Z')

const entry: WatchdogEntry = {
  scheduleId: 'GovernanceSync-scheduled',
  workflowType: 'GovernanceSync',
  taskQueue: 'default',
  args: [],
  interval: '30s',
  intervalMs: 30_000,
  missedFirings: 5,
  minAgeMs: 180_000,
  minGraceMs: 90_000,
  graceCapMs: 600_000,
}

const config: WatchdogConfig = {
  enabled: true,
  mode: 'enforce',
  tickMs: 30_000,
  minAgeMs: 180_000,
  missedFirings: 5,
  maxHealAttempts: 5,
  recreateAfter: 2,
  minGraceMs: 90_000,
  graceCapMs: 600_000,
  backoffBaseMs: 30_000,
  backoffCapMs: 300_000,
  describeDeadlineMs: 5_000,
}

function makeStore(over: Partial<HealState> = {}) {
  const order: string[] = []
  let attempts = over.unstucks ?? 0
  const store: WatchdogStateStore = {
    getState: jest.fn(),
    bumpUnstuck: jest.fn(async (id) => {
      order.push('bumpAttempt')
      attempts += 1
      return { ...defaultHealState(id), ...over, unstucks: attempts }
    }),
    bumpInjectedTrigger: jest.fn(async (id) => {
      order.push('bumpInjectedTrigger')
      return { ...defaultHealState(id), ...over, injectedTriggers: (over.injectedTriggers ?? 0) + 1 }
    }),
    compensateInjectedTrigger: jest.fn(async () => { order.push('compensateInjectedTrigger') }),
    baselineActionCount: jest.fn(async () => { order.push('baselineActionCount') }),
    setUnhealthy: jest.fn(async () => { order.push('setUnhealthy') }),
    setObservedUnhealthy: jest.fn(),
    resetOnRecreate: jest.fn(),
    resetLadder: jest.fn(),
    recordRecreate: jest.fn(),
  }
  return { store, order }
}

const transient = () => Object.assign(new Error('server unavailable'), { code: 14 })
const definitive = () => Object.assign(new Error('bad request'), { code: 3 })
const corrupt = () => Object.assign(new Error('Failed to update schedule'), {
  cause: Object.assign(new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'), { code: 9 }),
})

/**
 * Working handle+client for the RECREATE branch: describe() resolves so
 * ensureSchedule() reconciles instead of create()-ing, and trigger()/update()
 * both resolve. Use this for every case whose `attempts >= config.recreateAfter`,
 * since healSchedule calls `client.schedule.getHandle(...)` inside ensureSchedule
 * even when the test only cares about the update-path assertions.
 */
function workingHandleClient() {
  const handle = {
    trigger: jest.fn().mockResolvedValue(undefined),
    describe: jest.fn().mockResolvedValue({ action: { args: [] }, spec: { intervals: [{ every: 30_000 }] } }),
    update: jest.fn().mockResolvedValue(undefined),
  }
  const client = { schedule: { getHandle: () => handle, create: jest.fn() } }
  return { handle, client }
}

describe('healSchedule ladder', () => {
  it('attempts < recreateAfter: re-arms via update() AND consumes an attempt (M1/#279)', async () => {
    // A successful update() does not prove the scheduler resumed firing, so it must
    // still advance the ladder — otherwise continued staleness never escalates.
    const update = jest.fn().mockResolvedValue(undefined)
    const { store } = makeStore({ unstucks: 0 })
    await healSchedule({ update } as never, {} as never, entry, defaultHealState(entry.scheduleId), store, config, logger, NOW)
    expect(update).toHaveBeenCalledTimes(1)
    expect(store.bumpUnstuck).toHaveBeenCalledTimes(1)
  })

  it('B4: update() transient failure does NOT consume an attempt', async () => {
    const update = jest.fn().mockRejectedValue(transient())
    const { store } = makeStore({ unstucks: 0 })
    await healSchedule({ update } as never, {} as never, entry, defaultHealState(entry.scheduleId), store, config, logger, NOW)
    expect(store.bumpUnstuck).not.toHaveBeenCalled()
  })

  it('update() definitive failure DOES consume an attempt', async () => {
    const update = jest.fn().mockRejectedValue(definitive())
    const { store } = makeStore({ unstucks: 0 })
    await healSchedule({ update } as never, {} as never, entry, defaultHealState(entry.scheduleId), store, config, logger, NOW)
    expect(store.bumpUnstuck).toHaveBeenCalledTimes(1)
  })

  it('attempts >= recreateAfter: ensureSchedule, WRITE-AHEAD bump BEFORE trigger()', async () => {
    const { handle, client } = workingHandleClient()
    const { store, order } = makeStore({ unstucks: 2 })
    const state: HealState = { ...defaultHealState(entry.scheduleId), unstucks: 2 }
    await healSchedule(handle as never, client as never, entry, state, store, config, logger, NOW)
    expect(store.bumpInjectedTrigger).toHaveBeenCalledWith(entry.scheduleId, NOW)
    expect(handle.trigger).toHaveBeenCalledTimes(1)
    expect(order.indexOf('bumpInjectedTrigger')).toBeLessThan(order.indexOf('bumpAttempt'))
    // write-ahead: injection persisted before the trigger() effect
    const triggerCallOrder = handle.trigger.mock.invocationCallOrder[0]!
    const bumpCallOrder = (store.bumpInjectedTrigger as jest.Mock).mock.invocationCallOrder[0]!
    expect(bumpCallOrder).toBeLessThan(triggerCallOrder)
  })

  it('breaker: at MAX_HEAL_ATTEMPTS persists unhealthy=true', async () => {
    // attempts: 4 takes the RECREATE branch (4 >= recreateAfter=2), not the
    // update path — a plain `{ update }` mock with `client = {}` would throw
    // inside ensureSchedule's `client.schedule.getHandle(...)`. Use a working
    // handle+client; the assertion only cares that bumpAttempt (unconditional
    // in the recreate branch) pushes attempts 4->5 == maxHealAttempts.
    const { handle, client } = workingHandleClient()
    const { store } = makeStore({ unstucks: 4 }) // bump -> 5 == max
    const state: HealState = { ...defaultHealState(entry.scheduleId), unstucks: 4 }
    await healSchedule(handle as never, client as never, entry, state, store, config, logger, NOW)
    expect(store.setUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
  })

  it('update() corrupt (WFT failed): deletes+recreates, no ladder attempt consumed', async () => {
    const del = jest.fn().mockResolvedValue(undefined)
    const create = jest.fn().mockResolvedValue(undefined)
    const handle = { update: jest.fn().mockRejectedValue(corrupt()), delete: del, trigger: jest.fn() }
    const client = { schedule: { getHandle: () => handle, create } }
    const { store } = makeStore({ unstucks: 0 })
    await healSchedule(handle as never, client as never, entry, defaultHealState(entry.scheduleId), store, config, logger, NOW)
    expect(del).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(store.recordRecreate).toHaveBeenCalledWith(entry.scheduleId)
    expect(store.resetOnRecreate).toHaveBeenCalledWith(entry.scheduleId)
    expect(store.bumpUnstuck).not.toHaveBeenCalled()
  })

  it('trigger() corrupt (WFT failed): compensates write-ahead, then deletes+recreates', async () => {
    const del = jest.fn().mockResolvedValue(undefined)
    const create = jest.fn().mockResolvedValue(undefined)
    const handle = {
      trigger: jest.fn().mockRejectedValue(corrupt()),
      describe: jest.fn().mockResolvedValue({ action: { args: [] }, spec: { intervals: [{ every: 30_000 }] } }),
      update: jest.fn().mockResolvedValue(undefined),
      delete: del,
    }
    const client = { schedule: { getHandle: () => handle, create } }
    const { store } = makeStore({ unstucks: 2 })
    const state: HealState = { ...defaultHealState(entry.scheduleId), unstucks: 2 }
    await expect(healSchedule(handle as never, client as never, entry, state, store, config, logger, NOW)).resolves.toBeDefined()
    expect(store.compensateInjectedTrigger).toHaveBeenCalledWith(entry.scheduleId)
    expect(del).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(store.resetOnRecreate).toHaveBeenCalledWith(entry.scheduleId)
  })

  it('returns exponential backoff capped at backoffCapMs', async () => {
    // rBig uses attempts: 20, which takes the RECREATE branch (20 >= recreateAfter=2).
    // Share one working handle+client across all three calls so both the
    // update path (r0/r1) and the recreate path (rBig) succeed.
    const { handle, client } = workingHandleClient()
    const { store } = makeStore({ unstucks: 0 })
    const r0 = await healSchedule(handle as never, client as never, entry, { ...defaultHealState(entry.scheduleId), unstucks: 0 }, store, config, logger, NOW)
    expect(r0.nextBackoffMs).toBe(30_000) // base * 2^0
    const r1 = await healSchedule(handle as never, client as never, entry, { ...defaultHealState(entry.scheduleId), unstucks: 1 }, store, config, logger, NOW)
    expect(r1.nextBackoffMs).toBe(60_000) // base * 2^1
    const rBig = await healSchedule(handle as never, client as never, entry, { ...defaultHealState(entry.scheduleId), unstucks: 20 }, store, config, logger, NOW)
    expect(rBig.nextBackoffMs).toBe(300_000) // capped
  })
})
