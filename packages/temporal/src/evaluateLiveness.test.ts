import type { ScheduleDescription } from '@temporalio/client'
import { evaluateLiveness, graceFor, hasAutonomousFire, defaultHealState } from '@/scheduleWatchdog'
import type { HealState, WatchdogEntry } from '@/scheduleWatchdog'

const NOW = new Date('2026-07-01T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

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

function makeDesc(opts: {
  paused?: boolean
  running?: number
  recentTakenAt?: Date[]
  createdAt?: Date | undefined
  numActionsTaken?: number
}): ScheduleDescription {
  return {
    state: { paused: opts.paused ?? false },
    info: {
      runningActions: Array.from({ length: opts.running ?? 0 }, () => ({})),
      recentActions: (opts.recentTakenAt ?? []).map((takenAt) => ({ scheduledAt: takenAt, takenAt })),
      createdAt: 'createdAt' in opts ? opts.createdAt : ago(3_600_000),
      numActionsTaken: opts.numActionsTaken ?? 0,
    },
  } as unknown as ScheduleDescription
}

const state = (over: Partial<HealState> = {}): HealState => ({ ...defaultHealState(entry.scheduleId), ...over })

describe('graceFor', () => {
  it('clamps to MIN_GRACE floor', () => {
    // 5 * 30s = 150s > 90s floor, < 600s cap
    expect(graceFor(entry)).toBe(150_000)
  })
  it('floors tiny intervals to MIN_GRACE', () => {
    expect(graceFor({ ...entry, intervalMs: 10_000 })).toBe(90_000) // 5*10s=50s < 90s
  })
  it('caps huge products at graceCapMs', () => {
    expect(graceFor({ ...entry, intervalMs: 300_000 })).toBe(600_000) // 5*300s=1500s > 600s
  })
  it('honors a per-schedule maxGraceMs override', () => {
    expect(graceFor({ ...entry, maxGraceMs: 120_000 })).toBe(120_000)
  })
})

describe('hasAutonomousFire', () => {
  it('true when growth exceeds our injected triggers', () => {
    expect(hasAutonomousFire(makeDesc({ numActionsTaken: 12 }), state({ lastActionCount: 10, injectedTriggers: 1 }))).toBe(true)
  })
  it('false when all growth is our own triggers', () => {
    expect(hasAutonomousFire(makeDesc({ numActionsTaken: 11 }), state({ lastActionCount: 10, injectedTriggers: 1 }))).toBe(false)
  })
})

describe('evaluateLiveness', () => {
  it('paused -> paused (respected, never revived)', () => {
    expect(evaluateLiveness(makeDesc({ paused: true, recentTakenAt: [ago(10_000_000)] }), entry, NOW, state())).toBe('paused')
  })

  it('runningActions non-empty -> healthy (scheduler firing)', () => {
    expect(evaluateLiveness(makeDesc({ running: 1, recentTakenAt: [ago(10_000_000)] }), entry, NOW, state())).toBe('healthy')
  })

  it('recent autonomous takenAt -> healthy', () => {
    expect(evaluateLiveness(makeDesc({ recentTakenAt: [ago(20_000)], numActionsTaken: 100 }), entry, NOW, state())).toBe('healthy')
  })

  it('autonomous fire older than grace -> stale', () => {
    // last fire 5 min ago, grace 150s
    expect(evaluateLiveness(makeDesc({ recentTakenAt: [ago(300_000)], numActionsTaken: 100 }), entry, NOW, state())).toBe('stale')
  })

  it('never-fired but younger than MIN_AGE -> healthy (infancy grace)', () => {
    const desc = makeDesc({ recentTakenAt: [], createdAt: ago(60_000), numActionsTaken: 0 })
    expect(evaluateLiveness(desc, entry, NOW, state())).toBe('healthy')
  })

  it('never-fired and older than grace -> stale', () => {
    const desc = makeDesc({ recentTakenAt: [], createdAt: ago(3_600_000), numActionsTaken: 0 })
    expect(evaluateLiveness(desc, entry, NOW, state())).toBe('stale')
  })

  it('reference in the future (clock skew) -> unknown, never acts (D5)', () => {
    const desc = makeDesc({ recentTakenAt: [new Date(NOW.getTime() + 60_000)], numActionsTaken: 100 })
    expect(evaluateLiveness(desc, entry, NOW, state())).toBe('unknown')
  })

  it('createdAt in the future (clock skew) -> unknown (D5)', () => {
    const desc = makeDesc({ recentTakenAt: [], createdAt: new Date(NOW.getTime() + 60_000), numActionsTaken: 0 })
    expect(evaluateLiveness(desc, entry, NOW, state())).toBe('unknown')
  })

  it('missing createdAt -> unknown (never coerced)', () => {
    const desc = makeDesc({ recentTakenAt: [], createdAt: undefined, numActionsTaken: 0 })
    expect(evaluateLiveness(desc, entry, NOW, state())).toBe('unknown')
  })

  it('F6: a schedule kept alive ONLY by our trigger() still reads stale', () => {
    // Only recent action is our injected trigger; numActionsTaken grew by exactly injectedTriggers.
    const desc = makeDesc({ recentTakenAt: [ago(5_000)], createdAt: ago(3_600_000), numActionsTaken: 51 })
    const s = state({ lastActionCount: 50, injectedTriggers: 1, lastHealTriggerAt: ago(5_000) })
    expect(evaluateLiveness(desc, entry, NOW, s)).toBe('stale')
  })

  it('F6 recovery: a real autonomous fire after our trigger -> healthy', () => {
    const desc = makeDesc({ recentTakenAt: [ago(3_000)], createdAt: ago(3_600_000), numActionsTaken: 52 })
    const s = state({ lastActionCount: 50, injectedTriggers: 1 })
    expect(evaluateLiveness(desc, entry, NOW, s)).toBe('healthy')
  })

  it('N1: tolerates a recentActions entry with an absent takenAt (no throw)', () => {
    // Eventual-consistency partiality: one entry has takenAt, one does not.
    const desc = {
      state: { paused: false },
      info: {
        runningActions: [],
        recentActions: [{ scheduledAt: ago(3_600_000) }, { scheduledAt: ago(3_600_000), takenAt: ago(3_600_000) }],
        createdAt: ago(3_600_000),
        numActionsTaken: 100,
      },
    } as unknown as ScheduleDescription
    expect(() => evaluateLiveness(desc, entry, NOW, state())).not.toThrow()
    expect(evaluateLiveness(desc, entry, NOW, state())).toBe('stale')
  })
})
