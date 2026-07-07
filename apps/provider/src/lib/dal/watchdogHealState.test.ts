jest.mock('server-only', () => ({}))

const from = jest.fn()
jest.mock('@/db', () => ({
  getDb: () => ({ select: () => ({ from }) }),
}))

import { listWatchdogHealState } from './watchdogHealState'

describe('listWatchdogHealState (provider)', () => {
  beforeEach(() => from.mockReset())

  it('maps typed drizzle rows, serializing Date columns to ISO strings', async () => {
    from.mockResolvedValue([
      {
        scheduleId: 'GovernanceSync-scheduled',
        unstucks: 3,
        injectedTriggers: 1,
        lastHealTriggerAt: new Date('2026-07-01T00:00:00.000Z'),
        lastActionCount: 9,
        unhealthy: true,
        observedUnhealthy: false,
        recreations: 2,
        lastRecreatedAt: new Date('2026-07-01T00:05:00.000Z'),
      },
    ])
    const rows = await listWatchdogHealState()
    expect(rows).toEqual([
      {
        scheduleId: 'GovernanceSync-scheduled',
        unstucks: 3,
        injectedTriggers: 1,
        lastHealTriggerAt: '2026-07-01T00:00:00.000Z',
        lastActionCount: 9,
        unhealthy: true,
        observedUnhealthy: false,
        recreations: 2,
        lastRecreatedAt: '2026-07-01T00:05:00.000Z',
      },
    ])
  })

  it('maps null timestamp columns to null', async () => {
    from.mockResolvedValue([
      {
        scheduleId: 's',
        unstucks: 0,
        injectedTriggers: 0,
        lastHealTriggerAt: null,
        lastActionCount: 0,
        unhealthy: false,
        observedUnhealthy: false,
        recreations: 0,
        lastRecreatedAt: null,
      },
    ])
    const rows = await listWatchdogHealState()
    expect(rows[0].lastHealTriggerAt).toBeNull()
    expect(rows[0].lastRecreatedAt).toBeNull()
    expect(rows[0].recreations).toBe(0)
  })

  it('propagates errors (a DB outage must not read as "all schedules healthy")', async () => {
    from.mockRejectedValue(new Error('relation "watchdog_heal_state" does not exist'))
    await expect(listWatchdogHealState()).rejects.toThrow('watchdog_heal_state')
  })
})
