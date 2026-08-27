import { delegatorActivities } from './index'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import type { PocketBlockchain } from '@igniter/pocket'
import { NodeStatus } from '@igniter/db/middleman/enums'
import { UNSTAKE_TYPE_URL } from '@/lib/constants'

// @temporalio/activity `log` requires an activity context; stub it so the
// activity methods can run under plain jest.
jest.mock('@temporalio/activity', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const unsignedPayload = JSON.stringify({
  body: {
    messages: [
      { typeUrl: UNSTAKE_TYPE_URL, value: { operatorAddress: 'pokt1a', signer: 'pokt1owner' } },
      { typeUrl: UNSTAKE_TYPE_URL, value: { operatorAddress: 'pokt1b', signer: 'pokt1owner' } },
    ],
  },
})

function makeActivities(transaction: Record<string, unknown>, overrides: {
  sumStakeAmountByAddresses?: jest.Mock
  updateTransaction?: jest.Mock
  updateManyNodeAndLinkToTransaction?: jest.Mock
} = {}) {
  const sumStakeAmountByAddresses =
    overrides.sumStakeAmountByAddresses ?? jest.fn().mockResolvedValue('9300000000000')
  const updateTransaction = overrides.updateTransaction ?? jest.fn().mockResolvedValue(undefined)
  const updateManyNodeAndLinkToTransaction =
    overrides.updateManyNodeAndLinkToTransaction ?? jest.fn().mockResolvedValue(['pokt1a', 'pokt1b'])

  const dal = {
    transaction: {
      getTransaction: jest.fn().mockResolvedValue(transaction),
      updateTransaction,
    },
    node: { sumStakeAmountByAddresses, updateManyNodeAndLinkToTransaction },
  } as unknown as DAL

  return {
    activities: delegatorActivities(dal, {} as PocketBlockchain, {} as ProviderService),
    sumStakeAmountByAddresses,
    updateTransaction,
    updateManyNodeAndLinkToTransaction,
  }
}

const legacyTx = { id: 7, amount: null, createdBy: 'pokt1owner', unsignedPayload }

beforeEach(() => jest.clearAllMocks())

describe('updateUnstakingNodesFromTransaction self-heal', () => {
  it('backfills a null amount from the suppliers still holding their stake', async () => {
    const { activities, sumStakeAmountByAddresses, updateTransaction } = makeActivities(legacyTx)

    await expect(activities.updateUnstakingNodesFromTransaction(7)).resolves.toEqual(['pokt1a', 'pokt1b'])

    expect(sumStakeAmountByAddresses).toHaveBeenCalledWith(['pokt1a', 'pokt1b'], {
      createdBy: 'pokt1owner',
    })
    expect(updateTransaction).toHaveBeenCalledWith(7, { amount: '9300000000000' })
  })

  it('reads the stake before transitioning the nodes out of Staked', async () => {
    // Ordering is the whole point of doing this here rather than later.
    const calls: string[] = []
    const { activities } = makeActivities(legacyTx, {
      sumStakeAmountByAddresses: jest.fn(async () => { calls.push('sum'); return '1' }),
      updateManyNodeAndLinkToTransaction: jest.fn(async () => { calls.push('transition'); return [] }),
    })

    await activities.updateUnstakingNodesFromTransaction(7)

    expect(calls).toEqual(['sum', 'transition'])
  })

  it('leaves an amount that was already stored at creation alone', async () => {
    const { activities, sumStakeAmountByAddresses, updateTransaction } = makeActivities({
      ...legacyTx,
      amount: '4000000000',
    })

    await activities.updateUnstakingNodesFromTransaction(7)

    expect(sumStakeAmountByAddresses).not.toHaveBeenCalled()
    expect(updateTransaction).not.toHaveBeenCalled()
  })

  it('re-heals a legacy stored zero', async () => {
    // '0' predates the null-instead-of-zero contract and would otherwise render
    // 0.00 forever with no fallback.
    const { activities, sumStakeAmountByAddresses } = makeActivities({ ...legacyTx, amount: '0' })

    await activities.updateUnstakingNodesFromTransaction(7)

    expect(sumStakeAmountByAddresses).toHaveBeenCalled()
  })

  it('re-heals a stored value the reader would refuse to display', async () => {
    // The guard mirrors the reader: a non-digit string renders as the payload
    // fallback (0.00), so leaving it in place would strand the row forever.
    const { activities, sumStakeAmountByAddresses } = makeActivities({ ...legacyTx, amount: 'junk' })

    await activities.updateUnstakingNodesFromTransaction(7)

    expect(sumStakeAmountByAddresses).toHaveBeenCalled()
  })

  it('writes nothing when the stake cannot be vouched for', async () => {
    const { activities, updateTransaction } = makeActivities(legacyTx, {
      sumStakeAmountByAddresses: jest.fn().mockResolvedValue(null),
    })

    await activities.updateUnstakingNodesFromTransaction(7)

    expect(updateTransaction).not.toHaveBeenCalled()
  })

  it('still transitions the nodes when the backfill query throws', async () => {
    // The self-heal is cosmetic and runs ahead of the state transition, inside
    // an outer catch that swallows into `return []`. It must never be able to
    // strand suppliers in Staked while the chain has them unstaking.
    const { activities, updateManyNodeAndLinkToTransaction } = makeActivities(legacyTx, {
      sumStakeAmountByAddresses: jest.fn().mockRejectedValue(new Error('db down')),
    })

    await expect(activities.updateUnstakingNodesFromTransaction(7)).resolves.toEqual(['pokt1a', 'pokt1b'])

    expect(updateManyNodeAndLinkToTransaction).toHaveBeenCalledWith(
      ['pokt1a', 'pokt1b'],
      { status: NodeStatus.Unstaking },
      7,
    )
  })

  it('still transitions the nodes when the backfill write throws', async () => {
    const { activities, updateManyNodeAndLinkToTransaction } = makeActivities(legacyTx, {
      updateTransaction: jest.fn().mockRejectedValue(new Error('write conflict')),
    })

    await expect(activities.updateUnstakingNodesFromTransaction(7)).resolves.toEqual(['pokt1a', 'pokt1b'])

    expect(updateManyNodeAndLinkToTransaction).toHaveBeenCalled()
  })
})
