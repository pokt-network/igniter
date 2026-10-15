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
// group 1's own answer: 12 Staked suppliers on its domains, whatever the fleet-wide stats say
const fresh = { grossRewardsPerService: newRewards, rewardsSuppliersCount: 12, rewardsUpdatedAt: now.toISOString() }

function run(input: { fetched: SupplierStats | null; hasDomains?: boolean; tooManyDomains?: boolean }) {
  const groups = [group(1), group(2)]
  const result = mergeProviderSupplierStats({
    fetched: input.fetched,
    stored,
    hasDomains: input.hasDomains ?? true,
    tooManyDomains: input.tooManyDomains ?? false,
    groups,
    // group 2's rewards call failed
    rewardsByGroupId: [{ id: 1, rewards: newRewards, suppliersCount: 12 }, null],
    now,
  })
  return { ...result, input: groups }
}

describe('mergeProviderSupplierStats', () => {
  it('stats fetched: stores them stamped now; each group takes its own rewards and count', () => {
    const { supplierStats, groups } = run({ fetched })

    expect(supplierStats).toEqual({ ...fetched, updated_at: now.toISOString() })
    expect(groups[0]).toEqual({ id: 1, ...fresh })
    expect(groups[1]).toEqual({ id: 2, ...old })
  })

  it('stats call failed: keeps the stored stats with their old stamp; the groups update the same way', () => {
    const { supplierStats, groups } = run({ fetched: null })

    expect(supplierStats).toEqual(stored)
    expect(groups[0]).toEqual({ id: 1, ...fresh })
    expect(groups[1]).toEqual({ id: 2, ...old })
  })

  it('too many domains: stores no stats; the groups update the same way', () => {
    const { supplierStats, groups } = run({ fetched: null, tooManyDomains: true })

    expect(supplierStats).toBeNull()
    expect(groups[0]).toEqual({ id: 1, ...fresh })
  })

  it('no domains: no stats', () => {
    expect(run({ fetched: null, hasDomains: false }).supplierStats).toBeNull()
  })

  it('does not change the groups it was given', () => {
    const { input } = run({ fetched })

    expect(input).toEqual([{ id: 1, ...old }, { id: 2, ...old }])
  })
})
