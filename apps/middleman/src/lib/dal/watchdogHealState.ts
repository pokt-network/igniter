import { getDb } from '@/db'
import { watchdogHealStateTable } from '@igniter/db/middleman/schema'
import { createWatchdogHealStateStore, readWatchdogHealState } from '@igniter/db/watchdogStore'
import type { WatchdogHealState } from '@igniter/temporal/workflow-view'

/**
 * Read-only view of `watchdog_heal_state` for the admin Schedules panel.
 *
 * Thin per-app wrapper: the query + serialization semantics live in the shared
 * `readWatchdogHealState` factory (`@igniter/db/watchdogStore`); this only binds
 * the middleman schema's table. Errors propagate by design — see the factory doc.
 */
export async function listWatchdogHealState(): Promise<WatchdogHealState[]> {
  return readWatchdogHealState(getDb(), watchdogHealStateTable)
}

/**
 * Clear the recreate breaker (recreations=0, unhealthy=false; keeps lastRecreatedAt)
 * for one schedule. The operator Recreate action calls this BEFORE deleting so a
 * tripped breaker doesn't gate the watchdog's next NOT_FOUND recreate — manual
 * Recreate is the documented breaker reset.
 */
export async function resetWatchdogRecreations(scheduleId: string): Promise<void> {
  return createWatchdogHealStateStore(getDb(), watchdogHealStateTable).resetRecreations(scheduleId)
}
