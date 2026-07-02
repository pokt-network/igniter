jest.mock('server-only', () => ({}))

const execute = jest.fn()
jest.mock('@/db', () => ({
  getDb: () => ({ execute }),
}))

import { listWatchdogHealState } from './watchdogHealState'

describe('listWatchdogHealState (middleman)', () => {
  beforeEach(() => execute.mockReset())

  it('maps rows across column casings', async () => {
    execute.mockResolvedValue([
      {
        scheduleId: 'GovernanceSync-scheduled',
        attempts: 2,
        injected_triggers: 1,
        last_heal_trigger_at: '2026-07-01T00:00:00.000Z',
        last_action_count: 4,
        unhealthy: false,
        observed_unhealthy: true,
      },
    ])
    const rows = await listWatchdogHealState()
    expect(rows[0]).toEqual({
      scheduleId: 'GovernanceSync-scheduled',
      attempts: 2,
      injectedTriggers: 1,
      lastHealTriggerAt: '2026-07-01T00:00:00.000Z',
      lastActionCount: 4,
      unhealthy: false,
      observedUnhealthy: true,
    })
  })

  it('degrades to [] when the table is absent', async () => {
    execute.mockRejectedValue(new Error('relation "watchdog_heal_state" does not exist'))
    await expect(listWatchdogHealState()).resolves.toEqual([])
  })
})
