import { CompareSupplierServiceConfigHandler } from '@igniter/domain/provider/operations';

import type {
    SupplierServiceConfig,
    ServiceRevenueShare,
    SupplierEndpoint,
    ConfigOption,
} from '@igniter/pocket';
import { RPCType } from '@igniter/pocket/proto/pocket/shared/service';
import {
    matchingSupplierAndKey,
    mismatchedSupplierAndKey,
    pristineSupplier,
    OWNER_ADDRESS,
    PROVIDER_ADDRESS,
    DELEGATOR_ADDRESS,
} from '@igniter/domain/provider/utils/__fixtures__/supplier-data';
import { getExpectedServicesFromKey } from '@igniter/domain/provider/utils/suppliers';

const rs = (address: string): ServiceRevenueShare => ({ address });
const co = (key: number, value: string): ConfigOption => ({ key, value });
const ep = (
    url: string,
    rpcType: number,
    configs: ConfigOption[] = [],
): SupplierEndpoint => ({ url, rpcType, configs });
const cfg = (
    serviceId: string,
    revShare: ServiceRevenueShare[] = [],
    endpoints: SupplierEndpoint[] = [],
): SupplierServiceConfig => ({ serviceId, revShare, endpoints });

describe('CompareSupplierServiceConfigHandler', () => {
    let handler: CompareSupplierServiceConfigHandler;

    beforeAll(() => {
      handler = new CompareSupplierServiceConfigHandler();
    });

    it('returns true for semantically identical but differently ordered sets', () => {
        const a = [
            cfg(
                'svc-1',
                [rs('0xAAA'), rs('0xBBB')],
                [
                    ep('https://foo', 1, [co(1, 'x'), co(2, 'y')]),
                    ep('https://bar', 2),
                ],
            ),
            cfg('svc-2'),
        ];
        const b = [
            cfg('svc-2'),
            cfg(
                'svc-1',
                [rs('0xBBB'), rs('0xAAA')], // swapped order
                [
                    ep('https://bar', 2),
                    ep('https://foo', 1, [co(2, 'y'), co(1, 'x')]), // swapped order
                ],
            ),
        ];

        const result = handler.execute({ serviceConfigSetA: a, serviceConfigSetB: b });

        expect(result.isEqual).toBe(true);
        expect(result.diff).toEqual([]);
    });

    it('returns false when service IDs differ', () => {
        const a = [cfg('svc-1')];
        const b = [cfg('svc-2')];

        const result = handler.execute({ serviceConfigSetA: a, serviceConfigSetB: b });

        expect(result.isEqual).toBe(false);
        expect(result.diff.length).toBeGreaterThan(0);
    });

    it('returns false when list lengths differ', () => {
        const a = [cfg('svc-1')];
        const b: SupplierServiceConfig[] = [];

        const result = handler.execute({ serviceConfigSetA: a, serviceConfigSetB: b });

        expect(result.isEqual).toBe(false);
        expect(result.diff.length).toBeGreaterThan(0);
    });
});

// ── Fixture-based comparison tests ──────────────────────────────────────
describe('CompareSupplierServiceConfigHandler with fixtures', () => {
    let handler: CompareSupplierServiceConfigHandler;

    beforeAll(() => {
        handler = new CompareSupplierServiceConfigHandler();
    });

    it('returns isEqual true when supplier services match expected from key', () => {
        const expected = getExpectedServicesFromKey(matchingSupplierAndKey.key);
        const actual = matchingSupplierAndKey.supplier.services;

        const result = handler.execute({
            serviceConfigSetA: expected,
            serviceConfigSetB: actual,
        });

        expect(result.isEqual).toBe(true);
        expect(result.diff).toEqual([]);
    });

    it('returns isEqual false when supplier services differ from expected', () => {
        const expected = getExpectedServicesFromKey(mismatchedSupplierAndKey.key);
        const actual = mismatchedSupplierAndKey.supplier.services;

        const result = handler.execute({
            serviceConfigSetA: expected,
            serviceConfigSetB: actual,
        });

        expect(result.isEqual).toBe(false);
        expect(result.diff.length).toBeGreaterThan(0);
    });

    it('returns isEqual true when services are in different order but semantically equal', () => {
        const expected = getExpectedServicesFromKey(matchingSupplierAndKey.key);
        // Reverse the order of services
        const actual = [...matchingSupplierAndKey.supplier.services].reverse();

        const result = handler.execute({
            serviceConfigSetA: expected,
            serviceConfigSetB: actual,
        });

        expect(result.isEqual).toBe(true);
    });

    it('returns isEqual false when comparing empty services against populated', () => {
        const expected = getExpectedServicesFromKey(matchingSupplierAndKey.key);

        const result = handler.execute({
            serviceConfigSetA: expected,
            serviceConfigSetB: pristineSupplier.services,
        });

        expect(result.isEqual).toBe(false);
        expect(result.diff.length).toBeGreaterThan(0);
    });

    it('returns isEqual true when both sides are empty', () => {
        const result = handler.execute({
            serviceConfigSetA: [],
            serviceConfigSetB: [],
        });

        expect(result.isEqual).toBe(true);
        expect(result.diff).toEqual([]);
    });

    it('returns isEqual true when one side has duplicate addresses that sum to the same total', () => {
        // Chain may return two entries for the same address (e.g. 10% + 89%),
        // while the expected config has a single merged entry (99%).
        const withDuplicates: SupplierServiceConfig[] = [{
            serviceId: 'anvil',
            endpoints: [{ url: 'https://test.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
            revShare: [
                { address: OWNER_ADDRESS, revSharePercentage: 10 },
                { address: PROVIDER_ADDRESS, revSharePercentage: 1 },
                { address: OWNER_ADDRESS, revSharePercentage: 89 },
            ],
        }];
        const consolidated: SupplierServiceConfig[] = [{
            serviceId: 'anvil',
            endpoints: [{ url: 'https://test.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
            revShare: [
                { address: OWNER_ADDRESS, revSharePercentage: 99 },
                { address: PROVIDER_ADDRESS, revSharePercentage: 1 },
            ],
        }];

        const result = handler.execute({
            serviceConfigSetA: withDuplicates,
            serviceConfigSetB: consolidated,
        });

        expect(result.isEqual).toBe(true);
    });

    it('returns isEqual true when revShare entries are in different order', () => {
        const serviceA: SupplierServiceConfig[] = [{
            serviceId: 'anvil',
            endpoints: [{ url: 'https://test.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
            revShare: [
                { address: OWNER_ADDRESS, revSharePercentage: 80 },
                { address: PROVIDER_ADDRESS, revSharePercentage: 20 },
            ],
        }];
        const serviceB: SupplierServiceConfig[] = [{
            serviceId: 'anvil',
            endpoints: [{ url: 'https://test.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
            revShare: [
                { address: PROVIDER_ADDRESS, revSharePercentage: 20 },
                { address: OWNER_ADDRESS, revSharePercentage: 80 },
            ],
        }];

        const result = handler.execute({
            serviceConfigSetA: serviceA,
            serviceConfigSetB: serviceB,
        });

        expect(result.isEqual).toBe(true);
    });
});