import type { AddressGroupsJson } from '@igniter/db/middleman/schema'
import { postGraphql } from '@/lib/graphql'
import { configuredServiceRewards } from './configuredServiceRewards'
import { supplierRewardAmount } from './supplierRewardShare'
import type { RewardBySupplier } from './index'
import type { GroupRewards } from './providerSupplierStats'

export const GROUP_REWARDS_QUERY = `
      query RewardsByDomains($domains: [String!]!, $startTs: Datetime!, $endTs: Datetime!) {
        data: getRewardsByDomainsAndTimeGroupByService(
          domains: $domains,
          startTs: $startTs,
          endTs: $endTs
        )
      }
    `

/**
 * One address group's rewards of the last days for its own services, at the supplier's share. A
 * failed request throws (the group keeps its previous snapshot).
 */
export async function fetchAddressGroupRewards({
  indexerApiUrl,
  group,
  domains,
  startTs,
  endTs,
  supplierShare,
}: {
  indexerApiUrl: string
  group: AddressGroupsJson[number]
  domains: Array<string>
  startTs: Date
  endTs: Date
  supplierShare: number
}): Promise<GroupRewards> {
  const result = await postGraphql<{ data: { services: RewardBySupplier[] } }>(
    indexerApiUrl,
    GROUP_REWARDS_QUERY,
    { domains, startTs: startTs.toISOString(), endTs: endTs.toISOString() },
  )

  const rewards = configuredServiceRewards(result.data?.services ?? [], group.addressGroupServices.map((s) => s.serviceId))
    .map((entry) => ({ ...entry, amount: supplierRewardAmount(entry.gross_rewards, supplierShare) }))

  return { id: group.id, rewards }
}
