jest.mock('server-only', () => ({}))

const execute = jest.fn()
jest.mock('@/db', () => ({
  getDb: () => ({ execute }),
}))

import { listWatchdogHealState } from './watchdogHealState'

describe('listWatchdogHealState (provider)', () => {
  beforeEach(() => execute.mockReset())

  it('maps rows (array driver result), defensively across column casings', async () => {
    execute.mockResolvedValue([
      {
        scheduleId: 'GovernanceSync-scheduled',
        unstucks: 3,
        injectedTriggers: 1,
        lastHealTriggerAt: '2026-07-01T00:00:00.000Z',
        lastActionCount: 9,
        unhealthy: true,
        observed_unhealthy: false,
        recreations: 2,
        lastRecreatedAt: '2026-07-01T00:05:00.000Z',
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

  it('supports the {rows} driver shape', async () => {
    execute.mockResolvedValue({ rows: [{ scheduleId: 's', unstucks: 0, unhealthy: false }] })
    const rows = await listWatchdogHealState()
    expect(rows[0].scheduleId).toBe('s')
    expect(rows[0].unstucks).toBe(0)
  })

  it('defaults recreations to 0 and lastRecreatedAt to null when absent', async () => {
    execute.mockResolvedValue([{ scheduleId: 's', unstucks: 0, unhealthy: false }])
    const rows = await listWatchdogHealState()
    expect(rows[0].recreations).toBe(0)
    expect(rows[0].lastRecreatedAt).toBeNull()
  })

  it('degrades to [] when the table is absent (Part A not merged)', async () => {
    execute.mockRejectedValue(new Error('relation "watchdog_heal_state" does not exist'))
    await expect(listWatchdogHealState()).resolves.toEqual([])
  })
})
