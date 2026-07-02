import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ScheduledWorkflowType, buildWatchdogEntries } from '@/bootstrap'
import { parseWatchdogConfig } from '@igniter/temporal'

const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as never

describe('watchdog config parity (D9)', () => {
  it('every ScheduledWorkflowType has exactly one watchdog entry', () => {
    const entries = buildWatchdogEntries(parseWatchdogConfig(logger))
    const ids = entries.map((e) => e.scheduleId).sort()
    const expected = Object.values(ScheduledWorkflowType).map((t) => `${t}-scheduled`).sort()
    expect(ids).toEqual(expected)
  })

  it('every entry is fully populated (no NaN interval, has a workflowType + taskQueue)', () => {
    for (const e of buildWatchdogEntries(parseWatchdogConfig(logger))) {
      expect(Number.isFinite(e.intervalMs)).toBe(true)
      expect(e.intervalMs).toBeGreaterThan(0)
      expect(e.workflowType.length).toBeGreaterThan(0)
      expect(e.taskQueue.length).toBeGreaterThan(0)
    }
  })

  it('the worker instantiates the shared watchdog', () => {
    const src = readFileSync(join(__dirname, 'worker.ts'), 'utf8')
    expect(src).toMatch(/new ScheduleWatchdog\(/)
    expect(src).toMatch(/watchdog\.start\(\)/)
  })
})
