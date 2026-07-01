import type { Logger } from '@igniter/logger'
import { parseDuration } from '@/duration'

export type Verdict = 'healthy' | 'stale' | 'unknown' | 'paused'

/** A single monitored schedule, fully normalized (both apps produce this shape). */
export interface WatchdogEntry {
  scheduleId: string
  workflowType: string
  taskQueue: string
  args: unknown[]
  interval: string
  intervalMs: number
  missedFirings: number
  minAgeMs: number
  minGraceMs: number
  graceCapMs: number
  maxGraceMs?: number
}

/** Persisted heal state (mirrors the `watchdog_heal_state` row shape). */
export interface HealState {
  scheduleId: string
  attempts: number
  injectedTriggers: number
  lastHealTriggerAt: Date | null
  lastActionCount: number
  unhealthy: boolean
  observedUnhealthy: boolean
}

export interface WatchdogConfig {
  enabled: boolean
  mode: 'enforce' | 'observe'
  tickMs: number
  minAgeMs: number
  missedFirings: number
  maxHealAttempts: number
  recreateAfter: number
  minGraceMs: number
  graceCapMs: number
  backoffBaseMs: number
  backoffCapMs: number
  describeDeadlineMs: number
}

/**
 * DB-backed heal-state store. Implemented by each app's `dal.watchdog`.
 * Defined here so `packages/temporal` never imports `@igniter/db`.
 */
export interface WatchdogStateStore {
  getState(scheduleId: string): Promise<HealState | undefined>
  bumpAttempt(scheduleId: string): Promise<HealState>
  bumpInjectedTrigger(scheduleId: string, at: Date): Promise<HealState>
  setUnhealthy(scheduleId: string, unhealthy: boolean): Promise<void>
  setObservedUnhealthy(scheduleId: string, observed: boolean): Promise<void>
  resetOnRecreate(scheduleId: string): Promise<void>
  resetLadder(scheduleId: string, lastActionCount: number): Promise<void>
}

export function defaultHealState(scheduleId: string): HealState {
  return {
    scheduleId,
    attempts: 0,
    injectedTriggers: 0,
    lastHealTriggerAt: null,
    lastActionCount: 0,
    unhealthy: false,
    observedUnhealthy: false,
  }
}

/** Parse watchdog env config. Invalid values warn + default; NEVER throws (D8). */
export function parseWatchdogConfig(logger: Logger): WatchdogConfig {
  const dur = (name: string, def: number): number => {
    const raw = process.env[name]
    if (!raw) return def
    const ms = parseDuration(raw)
    if (ms == null) {
      logger.warn({ name, raw, default: def }, 'Invalid watchdog duration env; using default')
      return def
    }
    return ms
  }

  const count = (name: string, def: number): number => {
    const raw = process.env[name]
    if (!raw) return def
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      logger.warn({ name, raw, default: def }, 'Invalid watchdog count env; using default')
      return def
    }
    return n
  }

  return {
    enabled: process.env.SCHEDULE_WATCHDOG_ENABLED !== 'false',
    mode: process.env.SCHEDULE_WATCHDOG_MODE === 'observe' ? 'observe' : 'enforce',
    tickMs: dur('SCHEDULE_WATCHDOG_TICK', 30_000),
    minAgeMs: dur('SCHEDULE_WATCHDOG_MIN_AGE', 180_000),
    missedFirings: count('SCHEDULE_WATCHDOG_MISSED_FIRINGS', 5),
    maxHealAttempts: count('SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS', 5),
    recreateAfter: count('SCHEDULE_WATCHDOG_RECREATE_AFTER', 2),
    minGraceMs: 90_000,
    graceCapMs: 600_000,
    backoffBaseMs: 30_000,
    backoffCapMs: 300_000,
    describeDeadlineMs: 5_000,
  }
}
