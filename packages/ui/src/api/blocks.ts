import { cache } from 'react'
import { latestBlockDocument, numBlocksPerSessionDocument, statusQuery } from '@igniter/graphql/block'
import { getServerApolloClient } from '../lib/graphql/server'
import { unstable_cache } from 'next/cache'

export type LatestBlock = {
  height: string
  timestamp: string
}

export const getLatestBlock = cache(
  unstable_cache(
    async (graphQlUrl: string): Promise<LatestBlock> => {
      const { data } = await getServerApolloClient(graphQlUrl).query({
        query: latestBlockDocument
      })

      const latestBlock = data?.blocks?.nodes?.at(0)

      if (!latestBlock) {
        throw new Error('No latest block found')
      }

      return {
        height: latestBlock.height,
        // it does not include the Z
        timestamp: !latestBlock.timestamp.endsWith('Z') ? latestBlock.timestamp + 'Z' : latestBlock.timestamp
      }
    },
    ['latest_block'],
    { revalidate: 20}
  )
)

export const getStatusQuery = cache(
  unstable_cache(
    async (graphQlUrl: string): Promise<LatestBlock & {networkHeight: number}> => {
      const { data } = await getServerApolloClient(graphQlUrl).query({
        query: statusQuery
      })

      const latestBlock = data?.blocks?.nodes?.at(0)

      if (!latestBlock) {
        throw new Error('No latest block found')
      }

      return {
        height: latestBlock.id,
        networkHeight: data?._metadata?.targetHeight || 0,
        // it does not include the Z
        timestamp: !latestBlock.timestamp.endsWith('Z') ? latestBlock.timestamp + 'Z' : latestBlock.timestamp
      }
    },
    ['latest_block'],
    { revalidate: 20}
  )
)

export const getNumBlocksPerSession = cache(
  unstable_cache(
    async (graphQlUrl: string): Promise<number> => {
      const {data} = await getServerApolloClient(graphQlUrl).query({
        query: numBlocksPerSessionDocument
      })

      return Number(data?.params?.nodes?.at(0)?.value || 0)
    },
    ['blocks_per_session'],
    { revalidate: 60}
  )
)
