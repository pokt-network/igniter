import { getDb } from '@/db'
import { watchdogHealStateTable } from '@igniter/db/provider/schema'
import { readWatchdogHealState } from '@igniter/db/watchdogStore'
import type { WatchdogHealState } from '@igniter/temporal/workflow-view'

/**
 * Read-only view of `watchdog_heal_state` for the admin Schedules panel.
 *
 * Thin per-app wrapper: the query + serialization semantics live in the shared
 * `readWatchdogHealState` factory (`@igniter/db/watchdogStore`); this only binds
 * the provider schema's table. Errors propagate by design — see the factory doc.
 */
export async function listWatchdogHealState(): Promise<WatchdogHealState[]> {
  return readWatchdogHealState(getDb(), watchdogHealStateTable)
}
