import type { CdnDelegator } from '@/lib/dal/delegators'

export type CurrentDelegator = { id: number; name: string; identity: string; enabled: boolean }

export type DelegatorChange =
  | { kind: 'add'; name: string; identity: string }
  | { kind: 'rename'; id: number; identity: string; from: string; to: string }
  | { kind: 'rotate'; id: number; name: string; from: string; to: string }
  | { kind: 'disable'; id: number; name: string; identity: string }

/** Largest governance payload accepted, in rows and in bytes. */
export const MAX_GOVERNANCE_ROWS = 1000
export const MAX_GOVERNANCE_BODY_BYTES = 2 * 1024 * 1024

/** Default cap on changes one sync run may apply (GOVERNANCE_MAX_CHANGES_PER_RUN overrides). */
export const DEFAULT_MAX_CHANGES_PER_RUN = 20

export function maxChangesPerRun(raw: string | undefined = process.env.GOVERNANCE_MAX_CHANGES_PER_RUN): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CHANGES_PER_RUN
}

/**
 * Mirrors the diff Delegators.upsertFromGovernance applies (match on identity or
 * identityHistory; an enabled row's identity is never rotated; unlisted enabled rows
 * are disabled), so the activity can log every change and refuse an oversized run
 * BEFORE anything is written.
 */
export function planDelegatorChanges(current: CurrentDelegator[], cdn: CdnDelegator[]): DelegatorChange[] {
  const byIdentity = new Map(current.map((d) => [d.identity, d]))
  const listed = new Set<string>()
  const changes: DelegatorChange[] = []
  for (const d of cdn) {
    listed.add(d.identity)
    d.identityHistory.forEach((h) => listed.add(h))
    const match = [d.identity, ...d.identityHistory].map((id) => byIdentity.get(id)).find(Boolean)
    if (!match) {
      changes.push({ kind: 'add', name: d.name, identity: d.identity })
      continue
    }
    if (match.identity !== d.identity && !match.enabled) {
      changes.push({ kind: 'rotate', id: match.id, name: d.name, from: match.identity, to: d.identity })
    }
    if (match.name !== d.name) {
      changes.push({ kind: 'rename', id: match.id, identity: match.identity, from: match.name, to: d.name })
    }
  }
  for (const d of current) {
    if (d.enabled && !listed.has(d.identity)) {
      changes.push({ kind: 'disable', id: d.id, name: d.name, identity: d.identity })
    }
  }
  return changes
}
