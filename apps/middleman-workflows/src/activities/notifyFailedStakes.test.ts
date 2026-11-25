import { delegatorActivities } from './index'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import type { PocketBlockchain } from '@igniter/pocket'
import { STAKE_TYPE_URL } from '@/lib/constants'

// @temporalio/activity `log` requires an activity context; stub it so the
// activity methods can run under plain jest.
jest.mock('@temporalio/activity', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const PROVIDER = { id: 1, identity: 'pokt1provider', url: 'https://p.example' }
const unsignedPayload = JSON.stringify({
  body: {
    messages: [
      { typeUrl: STAKE_TYPE_URL, value: { operatorAddress: 'pokt1op1', ownerAddress: 'pokt1signer', signer: 'pokt1signer', stake: { amount: '1', denom: 'upokt' }, services: [] } },
    ],
  },
})

it("notifyProviderOfFailedStakes releases for the failed tx's signer (the owner the keys were delivered to)", async () => {
  const releaseSuppliers = jest.fn().mockResolvedValue(undefined)
  const dal = {
    transaction: {
      getTransaction: jest.fn().mockResolvedValue({
        id: 7, providerId: PROVIDER.identity, fromAddress: 'pokt1signer', createdBy: 'pokt1loginidentity', unsignedPayload,
      }),
    },
    provider: { getProvider: jest.fn().mockResolvedValue(PROVIDER) },
  } as unknown as DAL
  const activities = delegatorActivities(dal, {} as PocketBlockchain, { releaseSuppliers } as unknown as ProviderService)

  await expect(activities.notifyProviderOfFailedStakes(7)).resolves.toEqual(expect.objectContaining({ success: true }))
  expect(releaseSuppliers).toHaveBeenCalledWith(['pokt1op1'], PROVIDER, 'pokt1signer')
})
