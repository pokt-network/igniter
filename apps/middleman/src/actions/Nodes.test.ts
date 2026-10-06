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
let nodes: Array<Record<string, unknown>> = []
jest.mock('@/lib/dal/nodes', () => ({
  getNodesByUser: async () => nodes,
  getOwnerAddressesByUser: async () => ['pokt1owner'],
}))

import { GetProviderRewards, GetProviderStakes } from './Nodes'

// Server clock for every test.
const NOW = Date.parse('2026-10-05T21:16:00.000Z')

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  nodes = [
    { address: 'pokt1supplier', providerId: 'provider-1', provider: { name: 'Provider 1' }, status: 'staked', stakeAmount: '1000000' },
  ]
  query.mockResolvedValue({ data: { last24h: '1000000', last48h: '2000000' } })
  getLatestBlock.mockResolvedValue({ height: '100', timestamp: '2026-10-05T20:00:00.000Z' })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('GetProviderRewards window', () => {
  it('ends the windows at the timestamp the client passes', async () => {
    // Status timestamps arrive without the trailing Z.
    await GetProviderRewards('2026-10-05T21:15:09.045')

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
    await GetProviderRewards()

    expect(getLatestBlock).toHaveBeenCalledWith('https://indexer.test')
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T20:00:00.000Z' }),
    }))
  })

  it('accepts a fresh timestamp when the cached latest block is an hour old', async () => {
    // unstable_cache serves the stale entry while it revalidates; capping against it would
    // drop the settlement that triggered the refetch.
    getLatestBlock.mockResolvedValue({ height: '40', timestamp: '2026-10-05T20:16:00.000Z' })
    await GetProviderRewards('2026-10-05T21:15:30')

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T21:15:30.000Z' }),
    }))
  })

  it.each([
    ['up to 2 min ahead of the server clock', '2026-10-05T21:17:59Z', '2026-10-05T21:17:59.000Z'],
    ['48.5 h old', '2026-10-03T20:46:00Z', '2026-10-03T20:46:00.000Z'],
  ])('accepts a timestamp %s', async (_, timestamp, currentDate) => {
    await GetProviderRewards(timestamp)

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate }),
    }))
  })

  it.each([
    ['not a date', 'not-a-date'],
    ['a bare number Date would parse', '1'],
    ['a date without a time', '2026-10-05'],
    ['a timezone offset', '2026-10-05T20:00:00+02:00'],
    ['more than 2 min ahead of the server clock', '2026-10-05T21:18:01Z'],
    ['more than 49 h old', '2026-10-03T20:15:59Z'],
    ['far in the future', '9999-12-31T23:59:59Z'],
    ['a non-string', 12345],
  ])('falls back to the latest block for %s', async (_, timestamp) => {
    await GetProviderRewards(timestamp as string)

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({ currentDate: '2026-10-05T20:00:00.000Z' }),
    }))
  })
})

describe('GetProviderRewards per-provider failures', () => {
  it('returns null, not 0, for a provider whose batch failed', async () => {
    nodes = [
      { address: 'pokt1a', providerId: 'p1', provider: { name: 'One' }, status: 'staked', stakeAmount: '1000000' },
      { address: 'pokt1b', providerId: 'p2', provider: { name: 'Two' }, status: 'staked', stakeAmount: '1000000' },
    ]
    query.mockImplementation(async ({ variables }: { variables: { supplierAddresses: string[] } }) => {
      if (variables.supplierAddresses.includes('pokt1b')) throw new Error('indexer timeout')
      return { data: { last24h: '1000000', last48h: '2000000' } }
    })

    await expect(GetProviderRewards('2026-10-05T21:15:09')).resolves.toEqual([
      { identity: 'p1', rewards24h: 1, rewards48h: 2, coverage48h: null },
      { identity: 'p2', rewards24h: null, rewards48h: null, coverage48h: null },
    ])
  })
})

// The indexer's { range, data } shape (pocketdex range contract): data null means nothing in the
// window is covered, which is no data, not 0.
describe('GetProviderRewards with the range shape', () => {
  const range = {
    requested_from: '2026-10-03T21:15:09.000Z',
    requested_to: '2026-10-05T21:15:09.000Z',
    covered_from: '2026-10-04T12:00:00+00:00',
    covered_to: '2026-10-05T21:15:09+00:00',
    gaps: [],
  }

  it('reads data, and gives null when nothing is covered', async () => {
    query.mockResolvedValue({ data: { last24h: { range, data: null }, last48h: { range, data: 2000000 } } })

    await expect(GetProviderRewards('2026-10-05T21:15:09')).resolves.toEqual([
      { identity: 'provider-1', rewards24h: null, rewards48h: 2, coverage48h: range },
    ])
  })

  it('sums the data of every batch', async () => {
    nodes = Array.from({ length: 201 }, (_, i) => (
      { address: `pokt1s${i}`, providerId: 'p1', provider: { name: 'One' }, status: 'staked', stakeAmount: '1' }
    ))
    query.mockResolvedValue({ data: { last24h: { range, data: 1000000 }, last48h: { range, data: '3000000' } } })

    await expect(GetProviderRewards('2026-10-05T21:15:09')).resolves.toEqual([
      { identity: 'p1', rewards24h: 2, rewards48h: 6, coverage48h: range },
    ])
    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('GetProviderStakes', () => {
  it('counts staked suppliers and stake per provider from the database only', async () => {
    nodes = [
      { address: 'pokt1a', providerId: 'p1', provider: { name: 'One' }, status: 'staked', stakeAmount: '1000000' },
      { address: 'pokt1b', providerId: 'p1', provider: { name: 'One' }, status: 'staked', stakeAmount: '2000000' },
      { address: 'pokt1c', providerId: 'p1', provider: { name: 'One' }, status: 'unstaked', stakeAmount: '5000000' },
      { address: 'pokt1d', providerId: 'p2', provider: { name: 'Two' }, status: 'staked', stakeAmount: '4000000' },
      { address: 'pokt1e', providerId: 'p3', provider: { name: 'Three' }, status: 'unstaked', stakeAmount: '1000000' },
      { address: 'pokt1f', providerId: null, provider: null, status: 'staked', stakeAmount: '1000000' },
    ]

    await expect(GetProviderStakes()).resolves.toEqual([
      { identity: 'p1', name: 'One', suppliers: 2, stakedPokt: 3 },
      { identity: 'p2', name: 'Two', suppliers: 1, stakedPokt: 4 },
    ])
    expect(query).not.toHaveBeenCalled()
    expect(getLatestBlock).not.toHaveBeenCalled()
  })
})
