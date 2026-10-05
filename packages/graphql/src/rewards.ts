import { graphql } from './gql'

export const rewardsByAddressAndTimeGroupByDateDocument = graphql(`
  query getRewardsByAddressesAndTimeGroupByAddressAndDate($addresses: [String!]!, $supplierAddresses: [String!]!, $startDate: Datetime!, $endDate: Datetime!, $truncInterval: String!) {
    rewards: legacyRewardsBySuppliersAndTimeGroupByAddressAndDate(
      addresses: $addresses,
      supplierAddresses: $supplierAddresses,
      startDate: $startDate, 
      endDate: $endDate, 
      truncInterval: $truncInterval
    )
  }
`)

export const summaryDocument = graphql(`
  query nodesSummary(
    $filter: SupplierFilter!,
    $supplierAddresses: [String!]!
    $addresses: [String!]!,
    $currentDate: Datetime!,
    $last24Hours: Datetime!,
    $last48Hours: Datetime!
  ) {
    suppliers(
      filter: $filter
    ) {
      totalCount
      aggregates {
        sum {
          stakeAmount
        }
      }
    }
    last24h: legacyRewardsOfAddressesBySuppliersAndTime(
      addresses: $addresses,
      supplierAddresses: $supplierAddresses,
      startDate: $last24Hours,
      endDate: $currentDate,
    )

    last48h: legacyRewardsOfAddressesBySuppliersAndTime(
      addresses: $addresses,
      supplierAddresses: $supplierAddresses,
      startDate: $last48Hours,
      endDate: $currentDate,
    )
  }
`)
