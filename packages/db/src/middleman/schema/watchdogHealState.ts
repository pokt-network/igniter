import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/**
 * Per-schedule self-heal state for the Temporal schedule watchdog (Part A).
 * Write-ahead, UPSERT-keyed by `schedule_id`. Never references transactions.
 */
export const watchdogHealStateTable = pgTable('watchdog_heal_state', {
  scheduleId: text('schedule_id').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  injectedTriggers: integer('injected_triggers').notNull().default(0),
  lastHealTriggerAt: timestamp('last_heal_trigger_at'),
  lastActionCount: integer('last_action_count').notNull().default(0),
  unhealthy: boolean('unhealthy').notNull().default(false),
  observedUnhealthy: boolean('observed_unhealthy').notNull().default(false),
  recreations: integer('recreations').notNull().default(0),
  lastRecreatedAt: timestamp('last_recreated_at'),
})

export type WatchdogHealState = typeof watchdogHealStateTable.$inferSelect
export type InsertWatchdogHealState = typeof watchdogHealStateTable.$inferInsert
