import { graphql } from './gql'

export const latestBlockDocument = graphql(`
  query latestBlock {
    blocks(orderBy: ID_DESC, first: 1) {
      nodes {
        height: id
        timestamp
      }
    }
  }
`)

export const statusQuery = graphql(`
  query status {
    blocks(orderBy: ID_DESC, first: 1) {
      nodes {
        id
        timestamp
        totalRelays
      }
    }
    _metadata {
      targetHeight
      lastProcessedHeight
    }
    # The last settlement the indexer's money tables hold: moves when they write one (also a height
    # with only expirations), so it can lag the chain while the money step catches up
    lastSettlement: getLastSettlement {
      height
    }
  }
`)
