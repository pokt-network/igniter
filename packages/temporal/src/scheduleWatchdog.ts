import type { Logger } from '@igniter/logger'
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
  type Client,
  type ScheduleDescription,
  type ScheduleHandle,
  type ScheduleOptions,
  type ScheduleUpdateOptions,
} from '@temporalio/client'
import type { Duration } from '@temporalio/common'
import { parseDuration } from '@/duration'
import type { TemporalClient } from '@/types'

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
  recreations: number
  lastRecreatedAt: Date | null
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
  recordRecreate(scheduleId: string): Promise<void>
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
    recreations: 0,
    lastRecreatedAt: null,
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

/** clamp(missedFirings * intervalMs, MIN_GRACE, maxGraceMs ?? GRACE_CAP) (D2). */
export function graceFor(entry: WatchdogEntry): number {
  const raw = entry.missedFirings * entry.intervalMs
  const cap = entry.maxGraceMs ?? entry.graceCapMs
  return Math.min(Math.max(raw, entry.minGraceMs), cap)
}

/**
 * True iff the schedule has fired more times than we have injected via trigger()
 * since the persisted baseline — i.e. a genuine autonomous fire happened (D3/F6).
 */
export function hasAutonomousFire(desc: ScheduleDescription, state: HealState): boolean {
  return desc.info.numActionsTaken - state.lastActionCount > state.injectedTriggers
}

/**
 * Pure liveness verdict. No reaping, no progress guard, no unpause.
 * Uses ONLY verified SDK fields: state.paused, info.runningActions,
 * info.recentActions[].takenAt, info.createdAt, info.numActionsTaken.
 */
export function evaluateLiveness(
  desc: ScheduleDescription,
  entry: WatchdogEntry,
  now: Date,
  state: HealState,
): Verdict {
  if (desc.state.paused) return 'paused' // always respect; never revive/unpause
  if (desc.info.runningActions.length > 0) return 'healthy' // a run is in flight -> scheduler alive

  const createdAt = desc.info.createdAt
  if (!createdAt) return 'unknown' // missing timestamp -> skip, never coerce
  if (createdAt.getTime() > now.getTime()) return 'unknown' // skew guard (D5)

  const recent = desc.info.recentActions ?? []
  const latestTakenAt = recent.length
    ? new Date(Math.max(...recent.map((a) => a.takenAt.getTime())))
    : undefined
  if (latestTakenAt && latestTakenAt.getTime() > now.getTime()) return 'unknown' // skew guard (D5)

  // reference = last AUTONOMOUS fire (excludes our compensating triggers, D3).
  // If the only growth since baseline is our own trigger()s, treat as never-autonomously-fired.
  let reference: Date
  if (!latestTakenAt) reference = createdAt
  else if (hasAutonomousFire(desc, state)) reference = latestTakenAt
  else reference = createdAt

  if (reference.getTime() > now.getTime()) return 'unknown'
  if (now.getTime() - createdAt.getTime() <= entry.minAgeMs) return 'healthy' // infancy grace
  if (now.getTime() - reference.getTime() > graceFor(entry)) return 'stale'
  return 'healthy'
}

export function isNotFound(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: number }).code === 5) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /not.?found/i.test(msg)
}

/** Re-arm options for an in-place update() (no absent window). Cannot set memo (SDK). */
export function reArmOptions(prev: ScheduleUpdateOptions, entry: WatchdogEntry): ScheduleUpdateOptions {
  return {
    ...prev,
    action: { ...prev.action, args: entry.args },
    spec: { intervals: [{ every: entry.interval as Duration }] },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
  }
}

function createOptions(entry: WatchdogEntry): ScheduleOptions {
  return {
    scheduleId: entry.scheduleId,
    action: {
      type: 'startWorkflow',
      workflowType: entry.workflowType,
      taskQueue: entry.taskQueue,
      args: entry.args,
    },
    spec: { intervals: [{ every: entry.interval as Duration }] },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
  }
}

/**
 * Single create-OR-update primitive shared by bootstrap and the watchdog (D4).
 * describe() ok -> update on drift; describe() NOT_FOUND -> create (swallow
 * ScheduleAlreadyRunning); any other error -> rethrow.
 */
export async function ensureSchedule(client: Client, entry: WatchdogEntry, logger: Logger): Promise<void> {
  const handle = client.schedule.getHandle(entry.scheduleId)
  try {
    const desc = await handle.describe()
    const currentArgs = (desc.action as { args?: unknown[] }).args ?? []
    const currentEvery = desc.spec.intervals?.[0]?.every
    const argsChanged = JSON.stringify(currentArgs) !== JSON.stringify(entry.args)
    const intervalChanged = currentEvery !== entry.intervalMs
    if (argsChanged || intervalChanged) {
      logger.warn({ scheduleId: entry.scheduleId, argsChanged, intervalChanged }, 'Schedule config drift; updating')
      await handle.update((prev) => reArmOptions(prev, entry))
    }
  } catch (e) {
    if (!isNotFound(e)) throw e
    try {
      logger.warn({ scheduleId: entry.scheduleId }, 'Schedule not found; creating')
      await client.schedule.create(createOptions(entry))
    } catch (createErr) {
      if (createErr instanceof ScheduleAlreadyRunning) {
        logger.info({ scheduleId: entry.scheduleId }, 'Schedule already running; skipping create')
        return
      }
      throw createErr
    }
  }
}

const TRANSIENT_GRPC_CODES = new Set([4, 8, 10, 13, 14]) // DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED, INTERNAL, UNAVAILABLE

/** Transient (retryable) errors do NOT consume a heal attempt (B4). */
export function isTransient(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: number }).code : undefined
  if (code !== undefined) return TRANSIENT_GRPC_CODES.has(code)
  const msg = e instanceof Error ? e.message : String(e)
  return /deadline|unavailable|timeout/i.test(msg)
}

/** Race a promise against a deadline; the loser rejects. Used to bound describe(). */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC deadline exceeded after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Non-destructive heal ladder (D3). update() (no attempt on transient, B4) until
 * RECREATE_AFTER, then ensureSchedule + WRITE-AHEAD trigger. Breaker at MAX.
 */
export async function healSchedule(
  handle: ScheduleHandle,
  client: Client,
  entry: WatchdogEntry,
  state: HealState,
  store: WatchdogStateStore,
  config: WatchdogConfig,
  logger: Logger,
  now: Date,
): Promise<{ nextBackoffMs: number }> {
  const n = state.attempts
  let attemptsAfter = n

  if (n < config.recreateAfter) {
    try {
      await handle.update((prev) => reArmOptions(prev, entry))
      logger.info({ scheduleId: entry.scheduleId, attempt: n }, 'Heal: re-armed via update()')
    } catch (e) {
      if (isTransient(e)) {
        logger.warn({ err: e, scheduleId: entry.scheduleId }, 'Heal update() transient; no attempt consumed (B4)')
      } else {
        const row = await store.bumpAttempt(entry.scheduleId)
        attemptsAfter = row.attempts
        logger.warn({ err: e, scheduleId: entry.scheduleId, attempts: attemptsAfter }, 'Heal update() definitive failure; attempt consumed')
      }
    }
  } else {
    await ensureSchedule(client, entry, logger) // create only if NOT_FOUND (D4)
    await store.bumpInjectedTrigger(entry.scheduleId, now) // WRITE-AHEAD before the effect (D3)
    await handle.trigger() // one compensating run
    const row = await store.bumpAttempt(entry.scheduleId)
    attemptsAfter = row.attempts
    logger.warn({ scheduleId: entry.scheduleId, attempts: attemptsAfter }, 'Heal: reconciled + injected one compensating trigger')
  }

  if (attemptsAfter >= config.maxHealAttempts) {
    await store.setUnhealthy(entry.scheduleId, true)
    logger.error({ scheduleId: entry.scheduleId, attempts: attemptsAfter }, 'Heal breaker tripped: schedule marked unhealthy (page-worthy)')
  }

  return { nextBackoffMs: Math.min(config.backoffBaseMs * 2 ** n, config.backoffCapMs) }
}

/** Log-only process safety handlers (D7): never exit on stray rejections. */
export function installProcessSafetyHandlers(logger: Logger): void {
  process.on('unhandledRejection', (reason) =>
    logger.error({ reason }, 'Unhandled promise rejection (watchdog safety handler; not exiting)'),
  )
  process.on('uncaughtException', (err) =>
    logger.error({ err }, 'Uncaught exception (watchdog safety handler; not exiting)'),
  )
}

export interface ScheduleWatchdogDeps {
  client: TemporalClient
  entries: WatchdogEntry[]
  store: WatchdogStateStore
  config: WatchdogConfig
  logger: Logger
}

/**
 * In-worker self-heal orchestrator (D6/D7). Owns a dedicated client, a
 * self-rescheduling setTimeout loop re-armed only after each tick settles, and
 * an in-memory per-schedule backoff gate.
 */
export class ScheduleWatchdog {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> = Promise.resolve()
  private readonly nextEligibleAt = new Map<string, number>()
  private lastHeartbeatAt = 0

  constructor(private readonly deps: ScheduleWatchdogDeps) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.deps.logger.info(
      { mode: this.deps.config.mode, entries: this.deps.entries.length },
      'Schedule watchdog started',
    )
    this.scheduleNext(0)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.inFlight // let the current tick settle
    await this.deps.client.disconnect()
    this.deps.logger.info('Schedule watchdog stopped')
  }

  getHeartbeat(): number {
    return this.lastHeartbeatAt
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      if (!this.running) return
      this.inFlight = this.tick()
        .catch((err) => this.deps.logger.error({ err }, 'Watchdog tick failed'))
        .then(() => {
          if (this.running) this.scheduleNext(this.deps.config.tickMs)
        })
    }, delayMs)
  }

  async tick(): Promise<void> {
    const now = new Date()
    for (const entry of this.deps.entries) {
      try {
        await this.tickOne(entry, now)
      } catch (err) {
        this.deps.logger.error({ err, scheduleId: entry.scheduleId }, 'Watchdog per-schedule error (continuing)')
      }
    }
    this.lastHeartbeatAt = Date.now()
  }

  private async tickOne(entry: WatchdogEntry, now: Date): Promise<void> {
    const { client } = this.deps.client
    const { store, config, logger } = this.deps
    const state = (await store.getState(entry.scheduleId)) ?? defaultHealState(entry.scheduleId)
    const handle = client.schedule.getHandle(entry.scheduleId)

    let desc
    try {
      desc = await withDeadline(handle.describe(), config.describeDeadlineMs)
    } catch (e) {
      if (isNotFound(e)) {
        if (config.mode === 'enforce') {
          logger.warn({ scheduleId: entry.scheduleId }, 'Schedule NOT_FOUND; recreating')
          await store.recordRecreate(entry.scheduleId) // WRITE-AHEAD before the effect
          await ensureSchedule(client, entry, logger)
          await store.resetOnRecreate(entry.scheduleId) // S6: re-baseline after numActionsTaken resets to 0
        } else {
          await store.setObservedUnhealthy(entry.scheduleId, true)
        }
        return
      }
      logger.warn({ err: e, scheduleId: entry.scheduleId }, 'describe() transient; skipping (never stale)')
      return
    }

    const verdict = evaluateLiveness(desc, entry, now, state)
    switch (verdict) {
      case 'paused':
        logger.debug({ scheduleId: entry.scheduleId }, 'Schedule paused; respecting (no revive)')
        return
      case 'unknown':
        logger.warn({ scheduleId: entry.scheduleId }, 'Liveness unknown (skew/missing ts); skipping')
        return
      case 'healthy':
        if ((state.attempts > 0 || state.unhealthy) && hasAutonomousFire(desc, state)) {
          logger.info({ scheduleId: entry.scheduleId }, 'Autonomous fire observed; resetting heal ladder (F6)')
          await store.resetLadder(entry.scheduleId, desc.info.numActionsTaken)
          this.nextEligibleAt.delete(entry.scheduleId)
        }
        return
      case 'stale': {
        const eligibleAt = this.nextEligibleAt.get(entry.scheduleId) ?? 0
        if (now.getTime() < eligibleAt) {
          logger.debug({ scheduleId: entry.scheduleId }, 'Stale but within backoff; skipping')
          return
        }
        if (config.mode === 'observe') {
          logger.warn({ scheduleId: entry.scheduleId }, 'OBSERVE: stale; persisting observed_unhealthy, mutating nothing')
          await store.setObservedUnhealthy(entry.scheduleId, true)
          return
        }
        const { nextBackoffMs } = await healSchedule(handle, client, entry, state, store, config, logger, now)
        this.nextEligibleAt.set(entry.scheduleId, now.getTime() + nextBackoffMs)
        return
      }
    }
  }
}
