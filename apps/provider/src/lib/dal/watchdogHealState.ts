import { getDb } from '@/db'
import { sql } from 'drizzle-orm'
import type { WatchdogHealState } from '@igniter/temporal/workflow-view'

/** Read a value from a raw row across possible physical column casings (Part A owns the schema). */
function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k]
  }
  return undefined
}

/**
 * Read-only view of Part A's `watchdog_heal_state`. Uses raw SQL + `SELECT *`
 * so Part B does not import a schema symbol Part A may not have merged yet, and
 * degrades to `[]` when the table is absent.
 */
export async function listWatchdogHealState(): Promise<WatchdogHealState[]> {
  try {
    const result = await getDb().execute(sql`SELECT * FROM watchdog_heal_state`)
    const rows: Record<string, unknown>[] = Array.isArray(result)
      ? (result as Record<string, unknown>[])
      : ((result as { rows?: Record<string, unknown>[] }).rows ?? [])

    return rows.map((r) => {
      const lastHeal = pick(r, 'lastHealTriggerAt', 'lasthealtriggerat', 'last_heal_trigger_at')
      const lastRecreated = pick(r, 'lastRecreatedAt', 'lastrecreatedat', 'last_recreated_at')
      return {
        scheduleId: String(pick(r, 'scheduleId', 'scheduleid', 'schedule_id') ?? ''),
        unstucks: Number(pick(r, 'unstucks') ?? 0),
        injectedTriggers: Number(pick(r, 'injectedTriggers', 'injectedtriggers', 'injected_triggers') ?? 0),
        lastHealTriggerAt: lastHeal ? new Date(lastHeal as string | number | Date).toISOString() : null,
        lastActionCount: Number(pick(r, 'lastActionCount', 'lastactioncount', 'last_action_count') ?? 0),
        unhealthy: Boolean(pick(r, 'unhealthy')),
        observedUnhealthy: Boolean(pick(r, 'observedUnhealthy', 'observed_unhealthy', 'observedunhealthy')),
        recreations: Number(pick(r, 'recreations') ?? 0),
        lastRecreatedAt: lastRecreated ? new Date(lastRecreated as string | number | Date).toISOString() : null,
      }
    })
  } catch {
    // Table not present yet (Part A not merged) — schedule-health panel shows empty health.
    return []
  }
}
