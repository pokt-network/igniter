import { parseWatchdogConfig } from '@/scheduleWatchdog'

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as import('@igniter/logger').Logger

const CLEAR = [
  'SCHEDULE_WATCHDOG_ENABLED',
  'SCHEDULE_WATCHDOG_MODE',
  'SCHEDULE_WATCHDOG_TICK',
  'SCHEDULE_WATCHDOG_MIN_AGE',
  'SCHEDULE_WATCHDOG_MISSED_FIRINGS',
  'SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS',
  'SCHEDULE_WATCHDOG_RECREATE_AFTER',
]

beforeEach(() => {
  jest.clearAllMocks()
  for (const k of CLEAR) delete process.env[k]
})

describe('parseWatchdogConfig', () => {
  it('returns spec defaults when env is empty', () => {
    const c = parseWatchdogConfig(logger)
    expect(c).toMatchObject({
      enabled: true,
      mode: 'enforce',
      tickMs: 30_000,
      minAgeMs: 180_000,
      missedFirings: 5,
      maxHealAttempts: 5,
      recreateAfter: 2,
      maxRecreateAttempts: 3,
    })
  })

  it('only literal "false" disables', () => {
    process.env.SCHEDULE_WATCHDOG_ENABLED = 'no'
    expect(parseWatchdogConfig(logger).enabled).toBe(true)
    process.env.SCHEDULE_WATCHDOG_ENABLED = 'false'
    expect(parseWatchdogConfig(logger).enabled).toBe(false)
  })

  it('warns + defaults on an invalid duration, never throws', () => {
    process.env.SCHEDULE_WATCHDOG_TICK = 'banana'
    const c = parseWatchdogConfig(logger)
    expect(c.tickMs).toBe(30_000)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('warns + defaults on a non-finite count', () => {
    process.env.SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS = 'abc'
    const c = parseWatchdogConfig(logger)
    expect(c.maxHealAttempts).toBe(5)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('reads observe mode', () => {
    process.env.SCHEDULE_WATCHDOG_MODE = 'observe'
    expect(parseWatchdogConfig(logger).mode).toBe('observe')
  })
})
