import { getDb } from '@/db'
import { sql } from 'drizzle-orm'
import type { WatchdogHealState } from '@igniter/temporal/workflow-view'

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k]
  }
  return undefined
}

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
        attempts: Number(pick(r, 'attempts') ?? 0),
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
    return []
  }
}
