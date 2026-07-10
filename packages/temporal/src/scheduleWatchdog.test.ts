import { ScheduleAlreadyRunning } from '@temporalio/client'
import { ScheduleWatchdog, defaultHealState } from '@/scheduleWatchdog'
import type { HealState, WatchdogConfig, WatchdogEntry, WatchdogStateStore } from '@/scheduleWatchdog'
import type { TemporalClient } from '@/types'

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger } as never
const NOW_MS = Date.now()

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
  enabled: true, mode: 'enforce', tickMs: 30_000, minAgeMs: 180_000, missedFirings: 5,
  maxHealAttempts: 5, recreateAfter: 2, maxRecreateAttempts: 3, minGraceMs: 90_000, graceCapMs: 600_000,
  backoffBaseMs: 30_000, backoffCapMs: 300_000, describeDeadlineMs: 5_000,
}

function makeStore(state?: HealState): WatchdogStateStore {
  return {
    getState: jest.fn(async () => state),
    bumpUnstuck: jest.fn(async (id) => ({ ...defaultHealState(id), unstucks: 1 })),
    bumpInjectedTrigger: jest.fn(async (id) => ({ ...defaultHealState(id), injectedTriggers: 1 })),
    compensateInjectedTrigger: jest.fn(),
    baselineActionCount: jest.fn(),
    setUnhealthy: jest.fn(),
    setObservedUnhealthy: jest.fn(),
    resetOnRecreate: jest.fn(),
    resetLadder: jest.fn(),
    recordRecreate: jest.fn(),
    resetRecreations: jest.fn(),
  }
}

function descWith(over: Record<string, unknown>) {
  return {
    state: { paused: false },
    info: { runningActions: [], recentActions: [], createdAt: new Date(NOW_MS - 3_600_000), numActionsTaken: 0, ...over },
  }
}

function makeClient(handle: Record<string, unknown>, create = jest.fn()): TemporalClient {
  return {
    client: { schedule: { getHandle: () => handle, create } },
    disconnect: jest.fn().mockResolvedValue(undefined),
  } as never
}

describe('ScheduleWatchdog.tick', () => {
  it('paused schedule: skips, no mutation', async () => {
    const handle = { describe: jest.fn().mockResolvedValue({ state: { paused: true }, info: descWith({}).info }), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(handle.update).not.toHaveBeenCalled()
  })

  it('stale + enforce: heals via update() (attempt 0)', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ recentActions: [{ takenAt: new Date(NOW_MS - 3_600_000), scheduledAt: new Date(NOW_MS - 3_600_000) }], numActionsTaken: 100 })), update, trigger: jest.fn() }
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store: makeStore(), config, logger })
    await wd.tick()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('stale + enforce heal-start: baselines lastActionCount to numActionsTaken (F7b)', async () => {
    const store = makeStore() // fresh state -> unstucks 0
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ recentActions: [{ takenAt: new Date(NOW_MS - 3_600_000), scheduledAt: new Date(NOW_MS - 3_600_000) }], numActionsTaken: 100 })), update: jest.fn().mockResolvedValue(undefined), trigger: jest.fn() }
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.baselineActionCount).toHaveBeenCalledWith(entry.scheduleId, 100)
  })

  it('stale + enforce mid-episode (unstucks>0): does NOT re-baseline (F7b)', async () => {
    const store = makeStore({ ...defaultHealState(entry.scheduleId), unstucks: 1 })
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ recentActions: [{ takenAt: new Date(NOW_MS - 3_600_000), scheduledAt: new Date(NOW_MS - 3_600_000) }], numActionsTaken: 100 })), update: jest.fn().mockResolvedValue(undefined), trigger: jest.fn() }
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.baselineActionCount).not.toHaveBeenCalled()
  })

  it('stale + observe: persists observed_unhealthy, mutates nothing (S5)', async () => {
    const update = jest.fn()
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ recentActions: [{ takenAt: new Date(NOW_MS - 3_600_000), scheduledAt: new Date(NOW_MS - 3_600_000) }], numActionsTaken: 100 })), update, trigger: jest.fn() }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config: { ...config, mode: 'observe' }, logger })
    await wd.tick()
    expect(store.setObservedUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
    expect(update).not.toHaveBeenCalled()
  })

  it('healthy + prior attempts + autonomous fire: resets the ladder (F6)', async () => {
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ recentActions: [{ takenAt: new Date(NOW_MS - 5_000), scheduledAt: new Date(NOW_MS - 5_000) }], numActionsTaken: 52 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), unstucks: 3, lastActionCount: 50, injectedTriggers: 1 })
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.resetLadder).toHaveBeenCalledWith(entry.scheduleId, 52)
  })

  it('describe() NOT_FOUND + enforce: recordRecreate (write-ahead) -> ensureSchedule creates -> resetOnRecreate (S6)', async () => {
    const calls: string[] = []
    const create = jest.fn().mockImplementation(async () => { calls.push('create') })
    const handle = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { code: 5 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore()
    ;(store.recordRecreate as jest.Mock).mockImplementation(async () => { calls.push('recordRecreate') })
    ;(store.resetOnRecreate as jest.Mock).mockImplementation(async () => { calls.push('resetOnRecreate') })
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(create).toHaveBeenCalledTimes(1)
    expect(store.recordRecreate).toHaveBeenCalledWith(entry.scheduleId)
    expect(store.resetOnRecreate).toHaveBeenCalledWith(entry.scheduleId)
    expect(calls).toEqual(['recordRecreate', 'create', 'resetOnRecreate'])
  })

  it('describe() NOT_FOUND + observe: does not recordRecreate', async () => {
    const handle = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { code: 5 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config: { ...config, mode: 'observe' }, logger })
    await wd.tick()
    expect(store.recordRecreate).not.toHaveBeenCalled()
    expect(store.setObservedUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
  })

  it('describe() corrupt (WFT failed) + enforce: recordRecreate -> delete -> create -> resetOnRecreate', async () => {
    const calls: string[] = []
    const create = jest.fn().mockImplementation(async () => { calls.push('create') })
    const del = jest.fn().mockImplementation(async () => { calls.push('delete') })
    const corrupt = Object.assign(new Error('Failed to describe schedule'), {
      cause: Object.assign(new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'), { code: 9 }),
    })
    const handle = { describe: jest.fn().mockRejectedValue(corrupt), update: jest.fn(), trigger: jest.fn(), delete: del }
    const store = makeStore()
    ;(store.recordRecreate as jest.Mock).mockImplementation(async () => { calls.push('recordRecreate') })
    ;(store.resetOnRecreate as jest.Mock).mockImplementation(async () => { calls.push('resetOnRecreate') })
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(calls).toEqual(['recordRecreate', 'delete', 'create', 'resetOnRecreate'])
  })

  it('describe() corrupt + observe: persists observed_unhealthy, mutates nothing', async () => {
    const del = jest.fn()
    const corrupt = Object.assign(new Error('Failed to describe schedule'), {
      cause: Object.assign(new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'), { code: 9 }),
    })
    const handle = { describe: jest.fn().mockRejectedValue(corrupt), update: jest.fn(), trigger: jest.fn(), delete: del }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config: { ...config, mode: 'observe' }, logger })
    await wd.tick()
    expect(store.setObservedUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
    expect(del).not.toHaveBeenCalled()
    expect(store.recordRecreate).not.toHaveBeenCalled()
  })

  it('describe() corrupt + enforce: failing delete() skips round without resetOnRecreate', async () => {
    const del = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 13 }))
    const corrupt = Object.assign(new Error('Failed to describe schedule'), {
      cause: Object.assign(new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'), { code: 9 }),
    })
    const create = jest.fn()
    const handle = { describe: jest.fn().mockRejectedValue(corrupt), update: jest.fn(), trigger: jest.fn(), delete: del }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await expect(wd.tick()).resolves.toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(store.resetOnRecreate).not.toHaveBeenCalled()
  })

  const corruptErr = () => Object.assign(new Error('Failed to describe schedule'), {
    cause: Object.assign(new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'), { code: 9 }),
  })

  it('corrupt + enforce at the recreate cap: setUnhealthy(true), no recreate', async () => {
    const del = jest.fn()
    const create = jest.fn()
    const handle = { describe: jest.fn().mockRejectedValue(corruptErr()), update: jest.fn(), trigger: jest.fn(), delete: del }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), recreations: 3 })
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.setUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
    expect(del).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(store.recordRecreate).not.toHaveBeenCalled()
  })

  it('corrupt + enforce at the cap, already unhealthy: skips without re-marking', async () => {
    const del = jest.fn()
    const handle = { describe: jest.fn().mockRejectedValue(corruptErr()), update: jest.fn(), trigger: jest.fn(), delete: del }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), recreations: 3, unhealthy: true })
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.setUnhealthy).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('NOT_FOUND + enforce at the recreate cap: setUnhealthy(true), no recreate', async () => {
    const create = jest.fn()
    const handle = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { code: 5 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), recreations: 3 })
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.setUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
    expect(create).not.toHaveBeenCalled()
    expect(store.recordRecreate).not.toHaveBeenCalled()
  })

  it('corrupt + enforce: recreate backoff grows exponentially and halts at the cap', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-09T00:00:00Z'))
    try {
      const stateRef = { ...defaultHealState(entry.scheduleId) }
      const del = jest.fn()
      const create = jest.fn()
      const handle = { describe: jest.fn().mockRejectedValue(corruptErr()), update: jest.fn(), trigger: jest.fn(), delete: del }
      const store = makeStore()
      ;(store.getState as jest.Mock).mockImplementation(async () => ({ ...stateRef }))
      ;(store.recordRecreate as jest.Mock).mockImplementation(async () => { stateRef.recreations++ })
      const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })

      await wd.tick() // t=0, recreations 0 -> recreate #1, backoff 30s
      expect(del).toHaveBeenCalledTimes(1)
      await wd.tick() // still t=0: within backoff -> skipped
      expect(del).toHaveBeenCalledTimes(1)
      jest.setSystemTime(new Date('2026-07-09T00:00:30Z'))
      await wd.tick() // recreations 1 -> recreate #2, backoff 60s
      expect(del).toHaveBeenCalledTimes(2)
      jest.setSystemTime(new Date('2026-07-09T00:01:00Z')) // only +30s -> backoff grew, skipped
      await wd.tick()
      expect(del).toHaveBeenCalledTimes(2)
      jest.setSystemTime(new Date('2026-07-09T00:01:30Z')) // +60s since #2 -> eligible
      await wd.tick() // recreations 2 -> recreate #3
      expect(del).toHaveBeenCalledTimes(3)
      jest.setSystemTime(new Date('2026-07-09T00:10:00Z'))
      await wd.tick() // recreations 3 >= cap -> halt + page
      expect(del).toHaveBeenCalledTimes(3)
      expect(store.setUnhealthy).toHaveBeenCalledWith(entry.scheduleId, true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('corrupt recreate: AlreadyRunning swallow + re-describe still failing -> no resetOnRecreate', async () => {
    const del = jest.fn()
    const create = jest.fn().mockRejectedValue(new ScheduleAlreadyRunning('dup', entry.scheduleId))
    const handle = { describe: jest.fn().mockRejectedValue(corruptErr()), update: jest.fn(), trigger: jest.fn(), delete: del }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(del).toHaveBeenCalledTimes(1)
    expect(store.recordRecreate).toHaveBeenCalledWith(entry.scheduleId) // attempt still counted
    expect(store.resetOnRecreate).not.toHaveBeenCalled()
  })

  it('corrupt recreate: AlreadyRunning swallow + re-describe succeeding -> resetOnRecreate', async () => {
    const del = jest.fn()
    const create = jest.fn().mockRejectedValue(new ScheduleAlreadyRunning('dup', entry.scheduleId))
    const handle = {
      // corrupt for tickOne's describe AND ensureSchedule's describe; the third
      // (post-swallow verify) describe succeeds -> recreate may be marked healed.
      describe: jest.fn().mockRejectedValueOnce(corruptErr()).mockRejectedValueOnce(corruptErr()).mockResolvedValue(descWith({})),
      update: jest.fn(), trigger: jest.fn(), delete: del,
    }
    const store = makeStore()
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.resetOnRecreate).toHaveBeenCalledWith(entry.scheduleId)
  })

  it('healthy + autonomous fire after corrupt episode: resets the recreate breaker (episode-scoped, M1)', async () => {
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ runningActions: [{}], numActionsTaken: 15 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), unhealthy: true, recreations: 3, lastActionCount: 10 })
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    // resetRecreations zeroes the counter AND clears unhealthy in one write; the
    // separate setUnhealthy(false) is not used when recreations>0.
    expect(store.resetRecreations).toHaveBeenCalledWith(entry.scheduleId)
    expect(store.setUnhealthy).not.toHaveBeenCalled()
  })

  it('healthy verdict WITHOUT autonomous fire, recreations>0: does NOT reset the breaker (infancy-grace guard)', async () => {
    // numActionsTaken === lastActionCount: a recreated schedule describing healthy
    // during infancy grace, before it has ever fired on its own. Resetting here would
    // re-open the silent recreate-loop this breaker exists to stop.
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ runningActions: [{}], numActionsTaken: 10 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), unhealthy: true, recreations: 3, lastActionCount: 10 })
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.resetRecreations).not.toHaveBeenCalled()
    expect(store.setUnhealthy).not.toHaveBeenCalled()
    expect(store.resetLadder).not.toHaveBeenCalled()
  })

  it('healthy verdict with recreations=0: skips the breaker-reset write', async () => {
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ runningActions: [{}] })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId) }) // recreations 0, healthy
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.resetRecreations).not.toHaveBeenCalled()
    expect(store.setUnhealthy).not.toHaveBeenCalled()
  })

  it('healthy + autonomous fire, recreations=0 but unhealthy latched: clears the flag via ladder reset', async () => {
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ runningActions: [{}], numActionsTaken: 15 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), unhealthy: true, lastActionCount: 10 }) // recreations 0
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.resetRecreations).not.toHaveBeenCalled()
    // unhealthy is now cleared by resetLadder (bundled with the ladder reset),
    // not by a standalone setUnhealthy(false) call.
    expect(store.setUnhealthy).not.toHaveBeenCalled()
    expect(store.resetLadder).toHaveBeenCalledWith(entry.scheduleId, 15)
  })

  it('healthy verdict WITHOUT autonomous fire, unhealthy latched: does NOT clear the flag (infancy-grace guard)', async () => {
    const handle = { describe: jest.fn().mockResolvedValue(descWith({ runningActions: [{}], numActionsTaken: 10 })), update: jest.fn(), trigger: jest.fn() }
    const store = makeStore({ ...defaultHealState(entry.scheduleId), unhealthy: true, lastActionCount: 10 }) // recreations 0
    const wd = new ScheduleWatchdog({ client: makeClient(handle), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.setUnhealthy).not.toHaveBeenCalled()
    expect(store.resetLadder).not.toHaveBeenCalled()
  })

  it('capped schedule after resetRecreations: next NOT_FOUND tick recreates again (operator reset, H1)', async () => {
    const create = jest.fn()
    const handle = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('not found'), { code: 5 })), update: jest.fn(), trigger: jest.fn() }
    // Breaker had tripped (recreations at cap) but the operator Recreate reset it to 0.
    const store = makeStore({ ...defaultHealState(entry.scheduleId), recreations: 0 })
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config, logger })
    await wd.tick()
    expect(store.recordRecreate).toHaveBeenCalledWith(entry.scheduleId)
    expect(store.setUnhealthy).not.toHaveBeenCalled()
  })

  it('verify-describe after AlreadyRunning is deadline-bounded (L1): a hung re-describe is a verify-failure, no resetOnRecreate', async () => {
    const del = jest.fn()
    const create = jest.fn().mockRejectedValue(new ScheduleAlreadyRunning('dup', entry.scheduleId))
    const handle = {
      // corrupt for tickOne + ensureSchedule describes; the post-swallow verify hangs forever.
      describe: jest.fn()
        .mockRejectedValueOnce(corruptErr())
        .mockRejectedValueOnce(corruptErr())
        .mockImplementation(() => new Promise(() => {})), // never resolves
      update: jest.fn(), trigger: jest.fn(), delete: del,
    }
    const store = makeStore()
    const fastConfig = { ...config, describeDeadlineMs: 20 }
    const wd = new ScheduleWatchdog({ client: makeClient(handle, create), entries: [entry], store, config: fastConfig, logger })
    await wd.tick()
    // The bounded verify rejects -> treated as verify-failure -> NOT marked healed.
    expect(store.recordRecreate).toHaveBeenCalledWith(entry.scheduleId)
    expect(store.resetOnRecreate).not.toHaveBeenCalled()
  })

  it('describe() transient: skips, never treated as stale, never aborts pass', async () => {
    const store = makeStore()
    const handleBad = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 })), update: jest.fn(), trigger: jest.fn() }
    const wd = new ScheduleWatchdog({ client: makeClient(handleBad), entries: [entry], store, config, logger })
    await expect(wd.tick()).resolves.toBeUndefined()
    expect(store.setObservedUnhealthy).not.toHaveBeenCalled()
    expect(store.bumpUnstuck).not.toHaveBeenCalled()
  })
})

describe('ScheduleWatchdog.stop', () => {
  it('clears the timer and disconnects the dedicated client', async () => {
    const handle = { describe: jest.fn().mockResolvedValue(descWith({})), update: jest.fn(), trigger: jest.fn() }
    const client = makeClient(handle)
    const wd = new ScheduleWatchdog({ client, entries: [entry], store: makeStore(), config, logger })
    wd.start()
    await wd.stop()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })
})
