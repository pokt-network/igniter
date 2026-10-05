// The breakdown's rewards windows must end at the block the client read its settlement
// height from, not at the indexer's cached latest block, which can predate that settlement.
jest.mock('@igniter/graphql', () => ({ rewardsWindowsDocument: {} }))

const query = jest.fn()
jest.mock('@igniter/ui/graphql/server', () => ({ getServerApolloClient: () => ({ query }) }))

const getLatestBlock = jest.fn()
jest.mock('@igniter/ui/api/blocks', () => ({ getLatestBlock: (url: string) => getLatestBlock(url) }))

jest.mock('@/lib/utils/actions', () => ({
  requireAuth: async () => 'pokt1caller',
  requireAdmin: async () => undefined,
  assertOwnership: () => undefined,
}))
jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: async () => ({ indexerApiUrl: 'https://indexer.test', chainId: 'pocket' }),
}))
jest.mock('@/lib/dal/nodes', () => ({
  getNodesByUser: async () => [
    { address: 'pokt1supplier', providerId: 'provider-1', provider: { name: 'Provider 1' }, status: 'staked', stakeAmount: '1000000' },
  ],
  getOwnerAddressesByUser: async () => ['pokt1owner'],
}))

import { GetProviderBreakdown } from './Nodes'

beforeEach(() => {
  jest.clearAllMocks()
  query.mockResolvedValue({ data: { last24h: '1000000', last48h: '2000000' } })
  getLatestBlock.mockResolvedValue({ height: '100', timestamp: '2026-10-05T20:00:00.000Z' })
})

describe('GetProviderBreakdown rewards window', () => {
  it('ends the windows at the timestamp the client passes', async () => {
    // Status timestamps arrive without the trailing Z.
    await GetProviderBreakdown('2026-10-05T21:15:09.045')

    expect(getLatestBlock).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        currentDate: '2026-10-05T21:15:09.045Z',
        last24Hours: '2026-10-04T21:15:09.045Z',
        last48Hours: '2026-10-03T21:15:09.045Z',
        supplierAddresses: ['pokt1supplier'],
        addresses: ['pokt1owner'],
      }),
    }))
  })

  it('falls back to the latest block when no timestamp is passed', async () => {
    await GetProviderBreakdown()

    expect(getLatestBlock).toHaveBeenCalledWith('https://indexer.test')
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T20:00:00.000Z' }),
    }))
  })

  it('falls back to the latest block when the timestamp is not a date', async () => {
    await GetProviderBreakdown('not-a-date')

    expect(getLatestBlock).toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T20:00:00.000Z' }),
    }))
  })
})
