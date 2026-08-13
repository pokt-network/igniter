import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import { watchdogHealStateTable } from '@igniter/db/middleman/schema'
import { createWatchdogHealStateStore } from '@igniter/db/watchdogStore'
import type { Logger } from '@igniter/logger'
import type { HealState, WatchdogStateStore } from '@igniter/temporal'

/**
 * Thin per-app wrapper binding this app's `watchdogHealStateTable` to the shared
 * self-heal state store (`@igniter/db/watchdogStore`). All SQL semantics live in
 * the factory; this class only supplies the middleman table + preserves the
 * `new Watchdog(dbClient, logger)` construction contract its callers/tests rely on.
 */
export default class Watchdog implements WatchdogStateStore {
  logger: Logger
  dbClient: DBClient<typeof schema>
  private store: WatchdogStateStore

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
    this.store = createWatchdogHealStateStore(dbClient.db, watchdogHealStateTable)
  }

  getState(scheduleId: string): Promise<HealState | undefined> {
    return this.store.getState(scheduleId)
  }

  bumpUnstuck(scheduleId: string): Promise<HealState> {
    return this.store.bumpUnstuck(scheduleId)
  }

  bumpInjectedTrigger(scheduleId: string, at: Date): Promise<HealState> {
    return this.store.bumpInjectedTrigger(scheduleId, at)
  }

  compensateInjectedTrigger(scheduleId: string): Promise<void> {
    return this.store.compensateInjectedTrigger(scheduleId)
  }

  baselineActionCount(scheduleId: string, lastActionCount: number): Promise<void> {
    return this.store.baselineActionCount(scheduleId, lastActionCount)
  }

  setUnhealthy(scheduleId: string, unhealthy: boolean): Promise<void> {
    return this.store.setUnhealthy(scheduleId, unhealthy)
  }

  setObservedUnhealthy(scheduleId: string, observed: boolean): Promise<void> {
    return this.store.setObservedUnhealthy(scheduleId, observed)
  }

  resetOnRecreate(scheduleId: string): Promise<void> {
    return this.store.resetOnRecreate(scheduleId)
  }

  resetLadder(scheduleId: string, lastActionCount: number): Promise<void> {
    return this.store.resetLadder(scheduleId, lastActionCount)
  }

  recordRecreate(scheduleId: string): Promise<void> {
    return this.store.recordRecreate(scheduleId)
  }

  resetRecreations(scheduleId: string): Promise<void> {
    return this.store.resetRecreations(scheduleId)
  }
}
