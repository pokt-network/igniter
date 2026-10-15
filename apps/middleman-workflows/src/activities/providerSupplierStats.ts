import type { AddressGroupsJson } from '@igniter/db/middleman/schema'

// updated_at: when the stats were fetched; the middleman hides them once old (freshSupplierStats)
export type SupplierStats = { suppliers_count: number; total_staked_tokens: number; updated_at?: string }

// One address group's answer of this run: its rewards
export type GroupRewards = {
  id: number
  rewards: NonNullable<AddressGroupsJson[number]['grossRewardsPerService']>
}

/**
 * What one processProviderStatus run stores: the fleet-wide supplier stats, and the address groups
 * with the rewards of each group whose own call succeeded, whatever happened to the stats. Each such
 * group's rewardsSuppliersCount is the fleet count fetched in this run, 0 when none was. A group whose call failed keeps its previous rewards, count and rewardsUpdatedAt.
 * - Stats fetched in this run: stored with updated_at = now.
 * - The stats call failed: the stored stats are kept with their old updated_at, so the middleman hides
 *   them once old; stored stats without updated_at (written before it existed) are dropped, as they
 *   would never age.
 * - Too many domains for the stats call (never made, on every run), or no domains: no stats.
 */
export function mergeProviderSupplierStats({
  fetched,
  stored,
  hasDomains,
  tooManyDomains,
  groups,
  rewardsByGroupId,
  now,
}: {
  fetched: SupplierStats | null
  stored: SupplierStats | null
  hasDomains: boolean
  tooManyDomains: boolean
  groups: AddressGroupsJson
  rewardsByGroupId: Array<GroupRewards | null>
  now: Date
}): { supplierStats: SupplierStats | null; groups: AddressGroupsJson } {
  const byId = new Map(rewardsByGroupId.flatMap((entry) => (entry ? [[entry.id, entry] as const] : [])))

  return {
    supplierStats: fetched ? { ...fetched, updated_at: now.toISOString() } : hasDomains && !tooManyDomains && stored?.updated_at ? stored : null,
    groups: groups.map((group) => {
      const entry = byId.get(group.id)
      if (!entry) return group
      return {
        ...group,
        grossRewardsPerService: entry.rewards,
        rewardsSuppliersCount: fetched?.suppliers_count ?? 0,
        rewardsUpdatedAt: now.toISOString(),
      }
    }),
  }
}
