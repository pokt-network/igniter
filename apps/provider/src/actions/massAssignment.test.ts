// Create/update actions write explicit fields only; id/createdBy/updatedBy and any
// other column added to the input never reach the DAL.
jest.mock('server-only', () => ({}))

import { UserRole } from '@igniter/db/provider/enums'

const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const dal = {
  ag: { insert: jest.fn(), update: jest.fn() },
  svc: { insert: jest.fn(), update: jest.fn() },
  region: { insert: jest.fn(), update: jest.fn() },
  rm: { insert: jest.fn(), update: jest.fn() },
  del: { update: jest.fn() },
}
jest.mock('@/lib/dal/addressGroups', () => ({
  insert: (...a: unknown[]) => dal.ag.insert(...a), update: (...a: unknown[]) => dal.ag.update(...a),
  list: jest.fn(), simpleList: jest.fn(), remove: jest.fn(),
}))
jest.mock('@/lib/dal/services', () => ({
  insert: (...a: unknown[]) => dal.svc.insert(...a), update: (...a: unknown[]) => dal.svc.update(...a),
  list: jest.fn(), remove: jest.fn(),
}))
jest.mock('@/lib/dal/regions', () => ({
  insert: (...a: unknown[]) => dal.region.insert(...a), update: (...a: unknown[]) => dal.region.update(...a),
  list: jest.fn(), remove: jest.fn(),
}))
jest.mock('@/lib/dal/relayMiners', () => ({
  insert: (...a: unknown[]) => dal.rm.insert(...a), update: (...a: unknown[]) => dal.rm.update(...a),
  list: jest.fn(), remove: jest.fn(),
}))
jest.mock('@/lib/dal/delegators', () => ({
  update: (...a: unknown[]) => dal.del.update(...a),
  countDelegators: jest.fn(), disableAll: jest.fn(), enableAll: jest.fn(), list: jest.fn(), listAll: jest.fn(),
  applyGovernanceSync: jest.fn(),
}))
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: jest.fn() }))

import { CreateAddressGroup, UpdateAddressGroup } from './AddressGroups'
import { CreateService, UpdateService } from './Services'
import { CreateRegion, UpdateRegion } from './Regions'
import { CreateRelayMiner, UpdateRelayMiner } from './RelayMiners'
import { UpdateDelegator } from './Delegators'

const EXTRA_COLUMNS = { id: 999, createdBy: 'pokt1other', updatedBy: 'pokt1other', createdAt: new Date(0) }

beforeEach(() => {
  for (const g of Object.values(dal)) for (const fn of Object.values(g)) (fn as jest.Mock).mockReset().mockResolvedValue({})
  auth.mockResolvedValue({ user: { identity: 'pokt1owner', role: UserRole.Owner } })
})

describe('provider actions ignore columns outside their input', () => {
  it('CreateAddressGroup / UpdateAddressGroup', async () => {
    const group = { name: 'g', linkedAddresses: [], private: false, relayMinerId: 1, ...EXTRA_COLUMNS }
    const services = [{ serviceId: 'eth', addSupplierShare: false, supplierShare: null, revShare: [], endpointOverrides: {}, addressGroupId: 5, service: {} }]
    await CreateAddressGroup(group as never, services as never)
    expect(dal.ag.insert).toHaveBeenCalledWith(
      { name: 'g', linkedAddresses: [], private: false, relayMinerId: 1, createdBy: 'pokt1owner', updatedBy: 'pokt1owner' },
      [{ serviceId: 'eth', addSupplierShare: false, supplierShare: null, revShare: [], endpointOverrides: {} }],
    )
    await UpdateAddressGroup(1, group as never, [])
    expect(dal.ag.update).toHaveBeenCalledWith(1, { name: 'g', linkedAddresses: [], private: false, relayMinerId: 1, updatedBy: 'pokt1owner' }, [])
  })

  it('CreateService / UpdateService', async () => {
    const endpoints = [{ url: 'https://x', rpcType: 3, extra: 1 }]
    await CreateService({ serviceId: 's', name: 'n', ownerAddress: 'o', computeUnits: 1, revSharePercentage: 2, endpoints, ...EXTRA_COLUMNS } as never)
    expect(dal.svc.insert).toHaveBeenCalledWith({
      serviceId: 's', name: 'n', ownerAddress: 'o', computeUnits: 1, revSharePercentage: 2,
      endpoints: [{ url: 'https://x', rpcType: 3 }], createdBy: 'pokt1owner', updatedBy: 'pokt1owner',
    })
    await UpdateService('s', { revSharePercentage: 3, endpoints, serviceId: 'other', ...EXTRA_COLUMNS } as never)
    expect(dal.svc.update).toHaveBeenCalledWith('s', { revSharePercentage: 3, endpoints: [{ url: 'https://x', rpcType: 3 }], updatedBy: 'pokt1owner' })
  })

  it('CreateRegion / UpdateRegion', async () => {
    await CreateRegion({ displayName: 'EU', urlValue: 'eu', ...EXTRA_COLUMNS } as never)
    expect(dal.region.insert).toHaveBeenCalledWith({ displayName: 'EU', urlValue: 'eu', createdBy: 'pokt1owner', updatedBy: 'pokt1owner' })
    await UpdateRegion(1, { displayName: 'EU', urlValue: 'eu', ...EXTRA_COLUMNS } as never)
    expect(dal.region.update).toHaveBeenCalledWith(1, { displayName: 'EU', urlValue: 'eu', updatedBy: 'pokt1owner' })
  })

  it('CreateRelayMiner / UpdateRelayMiner', async () => {
    const rm = { name: 'r', identity: 'i', regionId: 1, domain: 'd', ...EXTRA_COLUMNS }
    await CreateRelayMiner(rm as never)
    expect(dal.rm.insert).toHaveBeenCalledWith({ name: 'r', identity: 'i', regionId: 1, domain: 'd', createdBy: 'pokt1owner', updatedBy: 'pokt1owner' })
    await UpdateRelayMiner(1, rm as never)
    expect(dal.rm.update).toHaveBeenCalledWith(1, { name: 'r', identity: 'i', regionId: 1, domain: 'd', updatedBy: 'pokt1owner' })
  })

  it('UpdateDelegator writes only enabled', async () => {
    await UpdateDelegator('pokt1d', { enabled: true, name: 'renamed', identity: 'x', ...EXTRA_COLUMNS } as never)
    expect(dal.del.update).toHaveBeenCalledWith('pokt1d', { enabled: true, updatedBy: 'pokt1owner' })
    const r = await UpdateDelegator('pokt1d', { enabled: 'yes' } as never)
    expect(r.success).toBe(false)
  })
})
