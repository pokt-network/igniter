/**
 * Unit tests for resolveDrainDestination — the PURE drain-destination decision
 * shared by the provider-UI path (explicit per-op choice) and the middleman /
 * automatic path (no choice -> settings flag).
 *
 * The cases here are pure (no DAL / Temporal). The jest.mock() block below only
 * stubs the heavy modules transitively imported by ./index so the module loads;
 * resolveDrainDestination itself touches none of them.
 */

// Mock heavy external dependencies that aren't relevant to this pure unit test.
jest.mock('@igniter/pocket', () => ({}))
jest.mock('@temporalio/activity', () => ({
  ApplicationFailure: { nonRetryable: jest.fn(), retryable: jest.fn() },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('@igniter/domain/provider/operations', () => ({
  BuildSupplierServiceConfigHandler: jest.fn(),
  CompareSupplierServiceConfigHandler: jest.fn(),
}))
jest.mock('@igniter/domain/provider/utils', () => ({
  getExpectedServicesFromKey: jest.fn(),
}))
jest.mock('@/lib/utils', () => ({
  addOrUpdateRemediationHistory: jest.fn(),
}))
jest.mock('@/lib/redactors', () => ({
  redactStakeSupplierParams: jest.fn(),
}))
jest.mock('@igniter/pocket/proto/pocket/shared/supplier', () => ({
  ServiceConfigUpdate: {},
}))

import { resolveDrainDestination } from './index'

describe('resolveDrainDestination', () => {
  const key = { stakeOwner: 'pokt1owner', ownerAddress: 'pokt1deliv' }

  it('mode none -> null', () =>
    expect(resolveDrainDestination(key, { mode: 'none' }, null)).toBeNull())

  it('mode owner -> stakeOwner', () =>
    expect(resolveDrainDestination(key, { mode: 'owner' }, null)).toBe('pokt1owner'))

  it('mode owner falls back to ownerAddress', () =>
    expect(
      resolveDrainDestination({ stakeOwner: '', ownerAddress: 'pokt1deliv' }, { mode: 'owner' }, null),
    ).toBe('pokt1deliv'))

  it('mode custom -> address', () =>
    expect(resolveDrainDestination(key, { mode: 'custom', address: 'pokt1x' }, null)).toBe('pokt1x'))

  it('no choice + flag off -> null', () =>
    expect(resolveDrainDestination(key, undefined, { returnSupplierFundsToOwner: false })).toBeNull())

  it('no choice + flag on -> owner', () =>
    expect(resolveDrainDestination(key, undefined, { returnSupplierFundsToOwner: true })).toBe('pokt1owner'))
})
