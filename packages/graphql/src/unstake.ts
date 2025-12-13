import { graphql } from './gql'

export const unstakeTimeAvgDocument = graphql(`
  query unstakeTimeAvg($startDate: Datetime!, $endDate: Datetime!) {
    blocks(
      filter: {
        timestamp: {
          greaterThanOrEqualTo: $startDate,
          lessThanOrEqualTo: $endDate
        }
      }
    ) {
      aggregates {
        average {
          timeToBlock
        }
      }
    }
    params(
      filter: {
        id: {
          in: ["shared-num_blocks_per_session", "shared-supplier_unbonding_period_sessions"]
        }
      }
    ) {
      nodes {
        key
        value
      }
    }
  }
`)
