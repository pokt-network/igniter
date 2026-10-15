import type { AddressGroupsJson } from '@igniter/db/middleman/schema'
import { mergeProviderSupplierStats, type SupplierStats } from './providerSupplierStats'

type Group = AddressGroupsJson[number]
type Rewards = NonNullable<Group['grossRewardsPerService']>

const now = new Date('2026-10-14T12:00:00Z')
const reward = (amount: string): Rewards[number] => ({
  relays: 1, service_id: 'eth', gross_rewards: 1, computed_units: 1, estimated_relays: 1,
  estimated_computed_units: 1, staked_suppliers: 0, amount,
})
const oldRewards: Rewards = [reward('old')]
const newRewards: Rewards = [reward('new')]
const old = { grossRewardsPerService: oldRewards, rewardsSuppliersCount: 40, rewardsUpdatedAt: '2026-10-10T00:00:00.000Z' }
const stored: SupplierStats = { suppliers_count: 40, total_staked_tokens: 4e12, updated_at: '2026-10-13T00:00:00.000Z' }
const fetched: SupplierStats = { suppliers_count: 55, total_staked_tokens: 5.5e12 }
const group = (id: number) => ({ id, ...old }) as unknown as Group
// group 1 after its own answer, with the fleet count of this run (0 when none was fetched)
const fresh = (rewardsSuppliersCount: number) => ({ grossRewardsPerService: newRewards, rewardsSuppliersCount, rewardsUpdatedAt: now.toISOString() })

function run(input: { fetched: SupplierStats | null; stored?: SupplierStats | null; hasDomains?: boolean; tooManyDomains?: boolean }) {
  const groups = [group(1), group(2)]
  const result = mergeProviderSupplierStats({
    fetched: input.fetched,
    stored: input.stored === undefined ? stored : input.stored,
    hasDomains: input.hasDomains ?? true,
    tooManyDomains: input.tooManyDomains ?? false,
    groups,
    // group 2's rewards call failed
    rewardsByGroupId: [{ id: 1, rewards: newRewards }, null],
    now,
  })
  return { ...result, input: groups }
}

describe('mergeProviderSupplierStats', () => {
  it('stats fetched: stores them stamped now; each group takes its rewards and the fleet count', () => {
    const { supplierStats, groups } = run({ fetched })

    expect(supplierStats).toEqual({ ...fetched, updated_at: now.toISOString() })
    expect(groups[0]).toEqual({ id: 1, ...fresh(55) })
    expect(groups[1]).toEqual({ id: 2, ...old })
  })

  it('stats call failed: keeps the stored stats with their old stamp; the groups take their rewards with count 0', () => {
    const { supplierStats, groups } = run({ fetched: null })

    expect(supplierStats).toEqual(stored)
    expect(groups[0]).toEqual({ id: 1, ...fresh(0) })
    expect(groups[1]).toEqual({ id: 2, ...old })
  })

  it('stats call failed and the stored stats have no stamp (written before updated_at): no stats', () => {
    const { supplierStats, groups } = run({ fetched: null, stored: { suppliers_count: 40, total_staked_tokens: 4e12 } })

    expect(supplierStats).toBeNull()
    expect(groups[0]).toEqual({ id: 1, ...fresh(0) })
  })

  it('too many domains: stores no stats; the groups take their rewards with count 0', () => {
    const { supplierStats, groups } = run({ fetched: null, tooManyDomains: true })

    expect(supplierStats).toBeNull()
    expect(groups[0]).toEqual({ id: 1, ...fresh(0) })
  })

  it('no domains: no stats', () => {
    expect(run({ fetched: null, hasDomains: false }).supplierStats).toBeNull()
  })

  it('does not change the groups it was given', () => {
    const { input } = run({ fetched })

    expect(input).toEqual([{ id: 1, ...old }, { id: 2, ...old }])
  })
})
