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
    // The cached latest block predates it; status timestamps arrive without the trailing Z.
    getLatestBlock.mockResolvedValue({ height: '99', timestamp: '2026-10-05T21:14:09.000Z' })
    await GetProviderBreakdown('2026-10-05T21:15:09.045')

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

  it('accepts a timestamp a few minutes after the cached latest block', async () => {
    await GetProviderBreakdown('2026-10-05T20:04:59Z')

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T20:04:59.000Z' }),
    }))
  })

  it.each([
    ['not a date', 'not-a-date'],
    ['a bare number Date would parse', '1'],
    ['a date without a time', '2026-10-05'],
    ['a timezone offset', '2026-10-05T20:00:00+02:00'],
    ['more than 5 minutes after the latest block', '2026-10-05T20:05:01Z'],
    ['far in the future', '9999-12-31T23:59:59Z'],
    ['a non-string', 12345],
  ])('falls back to the latest block for %s', async (_, timestamp) => {
    await GetProviderBreakdown(timestamp as string)

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T20:00:00.000Z' }),
    }))
  })
})
