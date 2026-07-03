import { eq, sql } from 'drizzle-orm'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import { watchdogHealStateTable } from '@igniter/db/middleman/schema'
import type { Logger } from '@igniter/logger'
import type { HealState, WatchdogStateStore } from '@igniter/temporal'

export default class Watchdog implements WatchdogStateStore {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async getState(scheduleId: string): Promise<HealState | undefined> {
    const [row] = await this.dbClient.db
      .select()
      .from(watchdogHealStateTable)
      .where(eq(watchdogHealStateTable.scheduleId, scheduleId))
      .limit(1)
    return row as HealState | undefined
  }

  async bumpUnstuck(scheduleId: string): Promise<HealState> {
    const [row] = await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, unstucks: 1 })
      .onConflictDoUpdate({
        target: watchdogHealStateTable.scheduleId,
        set: { unstucks: sql`${watchdogHealStateTable.unstucks} + 1` },
      })
      .returning()
    return row as HealState
  }

  async bumpInjectedTrigger(scheduleId: string, at: Date): Promise<HealState> {
    const [row] = await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, injectedTriggers: 1, lastHealTriggerAt: at })
      .onConflictDoUpdate({
        target: watchdogHealStateTable.scheduleId,
        set: {
          injectedTriggers: sql`${watchdogHealStateTable.injectedTriggers} + 1`,
          lastHealTriggerAt: at,
        },
      })
      .returning()
    return row as HealState
  }

  async setUnhealthy(scheduleId: string, unhealthy: boolean): Promise<void> {
    await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, unhealthy })
      .onConflictDoUpdate({ target: watchdogHealStateTable.scheduleId, set: { unhealthy } })
  }

  async setObservedUnhealthy(scheduleId: string, observed: boolean): Promise<void> {
    await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, observedUnhealthy: observed })
      .onConflictDoUpdate({
        target: watchdogHealStateTable.scheduleId,
        set: { observedUnhealthy: observed },
      })
  }

  async resetOnRecreate(scheduleId: string): Promise<void> {
    await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, lastActionCount: 0, injectedTriggers: 0 })
      .onConflictDoUpdate({
        target: watchdogHealStateTable.scheduleId,
        set: { lastActionCount: 0, injectedTriggers: 0 },
      })
  }

  async resetLadder(scheduleId: string, lastActionCount: number): Promise<void> {
    await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, unstucks: 0, unhealthy: false, injectedTriggers: 0, lastActionCount })
      .onConflictDoUpdate({
        target: watchdogHealStateTable.scheduleId,
        set: { unstucks: 0, unhealthy: false, injectedTriggers: 0, lastActionCount },
      })
  }

  async recordRecreate(scheduleId: string): Promise<void> {
    await this.dbClient.db
      .insert(watchdogHealStateTable)
      .values({ scheduleId, recreations: 1, lastRecreatedAt: new Date() })
      .onConflictDoUpdate({
        target: watchdogHealStateTable.scheduleId,
        set: {
          recreations: sql`${watchdogHealStateTable.recreations} + 1`,
          lastRecreatedAt: new Date(),
        },
      })
  }
}
