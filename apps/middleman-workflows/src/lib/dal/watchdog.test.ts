import Watchdog from '@/lib/dal/watchdog'
import { watchdogHealStateTable } from '@igniter/db/middleman/schema'

type Calls = {
  insertTable?: unknown
  values?: Record<string, unknown>
  onConflict?: { target: unknown; set: Record<string, unknown> }
  selected?: boolean
}

function fakeClient(returnRow: Record<string, unknown> | undefined) {
  const calls: Calls = {}
  const upsert = {
    returning: async () => (returnRow ? [returnRow] : []),
    then: (res: (rows: unknown[]) => unknown) => Promise.resolve(returnRow ? [returnRow] : []).then(res),
  }
  const insertChain = {
    values: (v: Record<string, unknown>) => {
      calls.values = v
      return {
        onConflictDoUpdate: (o: { target: unknown; set: Record<string, unknown> }) => {
          calls.onConflict = o
          return upsert
        },
      }
    },
  }
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => (returnRow ? [returnRow] : []),
  }
  const db = {
    insert: (t: unknown) => {
      calls.insertTable = t
      return insertChain
    },
    select: () => {
      calls.selected = true
      return selectChain
    },
  }
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { dbClient: { db } as never, logger: logger as never, calls }
}

describe('Watchdog DAL', () => {
  it('bumpUnstuck UPSERTs (insert…on conflict…returning) and returns the row', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled', unstucks: 1 })
    const dal = new Watchdog(dbClient, logger)
    const row = await dal.bumpUnstuck('X-scheduled')
    expect(calls.insertTable).toBe(watchdogHealStateTable)
    expect(calls.values).toMatchObject({ scheduleId: 'X-scheduled', unstucks: 1 })
    expect(calls.onConflict!.target).toBe(watchdogHealStateTable.scheduleId)
    expect(calls.onConflict!.set).toHaveProperty('unstucks')
    expect(row).toMatchObject({ unstucks: 1 })
  })

  it('bumpInjectedTrigger records lastHealTriggerAt and increments injectedTriggers', async () => {
    const at = new Date('2026-07-01T00:00:00Z')
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled', injectedTriggers: 1 })
    const dal = new Watchdog(dbClient, logger)
    await dal.bumpInjectedTrigger('X-scheduled', at)
    expect(calls.values).toMatchObject({ scheduleId: 'X-scheduled', injectedTriggers: 1, lastHealTriggerAt: at })
    expect(calls.onConflict!.set).toHaveProperty('injectedTriggers')
    expect(calls.onConflict!.set).toMatchObject({ lastHealTriggerAt: at })
  })

  it('getState returns undefined when no row exists', async () => {
    const { dbClient, logger } = fakeClient(undefined)
    const dal = new Watchdog(dbClient, logger)
    expect(await dal.getState('missing')).toBeUndefined()
  })

  it('setUnhealthy UPSERTs the flag', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled', unhealthy: true })
    const dal = new Watchdog(dbClient, logger)
    await dal.setUnhealthy('X-scheduled', true)
    expect(calls.onConflict!.set).toMatchObject({ unhealthy: true })
  })

  it('setObservedUnhealthy UPSERTs observed_unhealthy only', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled', observedUnhealthy: true })
    const dal = new Watchdog(dbClient, logger)
    await dal.setObservedUnhealthy('X-scheduled', true)
    expect(calls.onConflict!.set).toEqual({ observedUnhealthy: true })
  })

  it('resetOnRecreate zeroes lastActionCount + injectedTriggers (S6)', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled' })
    const dal = new Watchdog(dbClient, logger)
    await dal.resetOnRecreate('X-scheduled')
    expect(calls.onConflict!.set).toMatchObject({ lastActionCount: 0, injectedTriggers: 0 })
  })

  it('resetLadder clears attempts/unhealthy and re-baselines lastActionCount (F6)', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled' })
    const dal = new Watchdog(dbClient, logger)
    await dal.resetLadder('X-scheduled', 42)
    expect(calls.onConflict!.set).toMatchObject({ unstucks: 0, unhealthy: false, injectedTriggers: 0, lastActionCount: 42 })
  })

  it('recordRecreate inserts 1 on a fresh row', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled', recreations: 1 })
    const dal = new Watchdog(dbClient, logger)
    await dal.recordRecreate('X-scheduled')
    expect(calls.insertTable).toBe(watchdogHealStateTable)
    expect(calls.values).toMatchObject({ scheduleId: 'X-scheduled', recreations: 1 })
    expect(calls.values!.lastRecreatedAt).toBeInstanceOf(Date)
  })

  it('recordRecreate increments recreations and sets lastRecreatedAt on conflict', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled', recreations: 2 })
    const dal = new Watchdog(dbClient, logger)
    await dal.recordRecreate('X-scheduled')
    expect(calls.onConflict!.target).toBe(watchdogHealStateTable.scheduleId)
    expect(calls.onConflict!.set).toHaveProperty('recreations')
    expect(calls.onConflict!.set.lastRecreatedAt).toBeInstanceOf(Date)
  })

  it('resetOnRecreate does not touch recreations/lastRecreatedAt', async () => {
    const { dbClient, logger, calls } = fakeClient({ scheduleId: 'X-scheduled' })
    const dal = new Watchdog(dbClient, logger)
    await dal.resetOnRecreate('X-scheduled')
    expect(calls.onConflict!.set).not.toHaveProperty('recreations')
    expect(calls.onConflict!.set).not.toHaveProperty('lastRecreatedAt')
  })
})
