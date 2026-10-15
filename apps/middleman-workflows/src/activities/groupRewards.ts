import type { AddressGroupsJson } from '@igniter/db/middleman/schema'
import { postGraphqlPartial } from '@/lib/graphql'
import { configuredServiceRewards } from './configuredServiceRewards'
import { supplierRewardAmount } from './supplierRewardShare'
import type { RewardBySupplier } from './index'
import type { GroupRewards } from './providerSupplierStats'

// Domains and services getSupplierFleetList takes in one call (getRewardsByDomainsAndTimeGroupByService has no cap)
export const MAX_COUNT_LIST = 200

// The group's rewards and, in the same request, its own Staked supplier count (the rewards answer
// has none): the Staked suppliers on its domains with a live config for one of its services. Today
// pocketdex can match the domain and the service on two different config rows of a supplier; a fix
// that requires the same row is queued for its next release. The count takes at most 200 domains
// and 200 services; the rewards have no cap.
export const GROUP_REWARDS_QUERY = `
      query RewardsByDomains($domains: [String!]!, $startTs: Datetime!, $endTs: Datetime!, $services: [String!], $withCount: Boolean!) {
        data: getRewardsByDomainsAndTimeGroupByService(
          domains: $domains,
          startTs: $startTs,
          endTs: $endTs
        )
        count: getSupplierFleetList(domains: $domains, services: $services, stakeStatuses: ["Staked"], bySupplier: false) @include(if: $withCount) {
          supplierCount
        }
      }
    `

/**
 * One address group's rewards of the last days, at the supplier's share, and its own supplier count,
 * in one request read alias by alias: an error on the rewards alias throws (the group keeps its
 * previous snapshot); a failed or missing count keeps the rewards with count 0 and calls
 * onCountFailed. The count is only the fallback for a service row without staked_suppliers (the
 * readers take `staked_suppliers || rewardsSuppliersCount`), so a 0 matters only where a
 * service row has none. Over MAX_COUNT_LIST domains or services the count is not
 * asked for: 0.
 */
export async function fetchAddressGroupRewards({
  indexerApiUrl,
  group,
  domains,
  startTs,
  endTs,
  supplierShare,
  onCountFailed,
}: {
  indexerApiUrl: string
  group: AddressGroupsJson[number]
  domains: Array<string>
  startTs: Date
  endTs: Date
  supplierShare: number
  onCountFailed: (error: string) => void
}): Promise<GroupRewards> {
  // Trimmed and unique, as configuredServiceRewards matches them (the indexer compares exactly)
  const services = Array.from(new Set(group.addressGroupServices.map((s) => s.serviceId.trim())))
  const withCount = domains.length <= MAX_COUNT_LIST && services.length <= MAX_COUNT_LIST
  const { data: result, errors } = await postGraphqlPartial<{
    data: { services: RewardBySupplier[] }
    count: Array<{ supplierCount: string } | null> | null
  }>(
    indexerApiUrl,
    GROUP_REWARDS_QUERY,
    { domains, startTs: startTs.toISOString(), endTs: endTs.toISOString(), services, withCount },
  )
  if (errors.data || !result.data) throw new Error(`Indexer rewards failed: ${errors.data ?? 'no data'}`)

  const countRow = withCount ? result.count?.[0] : undefined
  if (withCount && !countRow) onCountFailed(errors.count ?? `no count row (count: ${JSON.stringify(result.count)})`)

  const rewards = configuredServiceRewards(result.data.services ?? [], group.addressGroupServices.map((s) => s.serviceId))
    .map((entry) => ({ ...entry, amount: supplierRewardAmount(entry.gross_rewards, supplierShare) }))

  return { id: group.id, rewards, suppliersCount: countRow ? Number(countRow.supplierCount ?? 0) : 0 }
}
