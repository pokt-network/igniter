import { BuildSupplierServiceConfigHandler } from '@igniter/domain/provider/operations';
import {
    BuildSupplierServiceConfigInput,
} from '@igniter/domain/provider/operations';
import { SupplierServiceConfig, ServiceRevenueShare } from '@igniter/pocket';

jest.mock('@igniter/domain/provider/utils', () => ({
    ...jest.requireActual('@igniter/domain/provider/utils'),
    getRevShare: jest.fn(),
    getEndpointInterpolatedUrl: jest.fn(),
}));

import {
    getRevShare,
    getEndpointInterpolatedUrl,
} from '@igniter/domain/provider/utils';
import {RevenueShareOverflowError} from "@igniter/domain/provider/errors";

const mockedGetRevShare = getRevShare as jest.MockedFunction<typeof getRevShare>;
const mockedGetEpUrl =
    getEndpointInterpolatedUrl as jest.MockedFunction<
        typeof getEndpointInterpolatedUrl
    >;

describe('BuildSupplierServiceConfigHandler', () => {
    const handler = new BuildSupplierServiceConfigHandler();

    const operatorAddress = 'op_addr';
    const ownerAddress = 'owner_addr';

    const addressGroupServiceConfig: SupplierServiceConfig = {
        serviceId: 'svc-1',
    } as unknown as SupplierServiceConfig;

    const interpolationParams = {
        sid: 'svc-1',
        rm: 'relay_miner_id',
        region: 'eu-west',
        domain: 'example.com',
    };

    const input: BuildSupplierServiceConfigInput = {
        operatorAddress,
        ownerAddress,
        requestRevShare: [
            { address: 'request_addr', revSharePercentage: 20 },
        ],
        services: [
            {
                serviceId: 'svc-1',
                endpoints: [
                    { url: 'https://dummy', rpcType: 'REST' },
                    { url: 'https://dummy-grpc', rpcType: 1 },
                ],
            },
        ] as any,
        addressGroup: {
            addressGroupServices: [addressGroupServiceConfig],
            relayMiner: {
                identity: interpolationParams.rm,
                region: { urlValue: interpolationParams.region },
                domain: interpolationParams.domain,
            },
        } as any,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockedGetRevShare.mockReturnValue([
            { address: operatorAddress, revSharePercentage: 30 },
        ]);

        mockedGetEpUrl.mockReturnValue('https://interpolated');
    });

    it('builds expected supplier service configs', () => {
        const result = handler.execute(input);

        expect(result).toHaveLength(1);

        const cfg: SupplierServiceConfig = result[0];

        expect(cfg.serviceId).toBe('svc-1');
        expect(cfg.endpoints).toHaveLength(2);
        expect(cfg.endpoints[0]).toMatchObject({
            url: 'https://interpolated',
            rpcType: 4,
            configs: [],
        });

      expect(cfg.endpoints[1]).toMatchObject({
        url: 'https://interpolated',
        rpcType: 1,
        configs: [],
      });

        expect(cfg.revShare).toEqual(
            expect.arrayContaining([
                { address: operatorAddress, revSharePercentage: 30 },
                { address: 'request_addr', revSharePercentage: 20 },
                { address: ownerAddress, revSharePercentage: 50 },
            ]),
        );

        expect(mockedGetRevShare).toHaveBeenCalledWith(
            addressGroupServiceConfig,
            operatorAddress,
        );
        expect(mockedGetEpUrl).toHaveBeenCalledWith(
            input.services[0]?.endpoints[0],
            interpolationParams,
        );
    });

    it('filters out zero-percentage entries returned by helpers', () => {
        mockedGetRevShare.mockReturnValue([
            { address: operatorAddress, revSharePercentage: 0 },
        ]);

        const [cfg] = handler.execute(input);

        expect(cfg?.revShare.some((r: ServiceRevenueShare) => r.revSharePercentage === 0)).toBe(false);
    });

    it('merges duplicate address entries when ownerAddress equals operatorAddress', () => {
        // When owner and operator are the same address, getRevShare adds it once
        // (as supplierShare) and the handler adds it again as the owner remainder.
        // The result should have a single merged entry.
        mockedGetRevShare.mockReturnValue([
            { address: ownerAddress, revSharePercentage: 30 }, // operator == owner
        ]);

        const sameAddressInput = {
            ...input,
            operatorAddress: ownerAddress, // same as ownerAddress
        };

        const result = handler.execute(sameAddressInput);
        const cfg = result[0]!;

        const ownerEntries = cfg.revShare.filter((r: ServiceRevenueShare) => r.address === ownerAddress);
        expect(ownerEntries).toHaveLength(1);
        // 30% from getRevShare + 50% remainder = 80% total for owner; request_addr gets 20%
        expect(ownerEntries[0]?.revSharePercentage).toBe(80);
    });

    it('throws RevenueShareOverflowError when total revshare exceeds 100', () => {
        const overflowInput = {
            ...input,
            requestRevShare: [
                { address: 'request_addr', revSharePercentage: 80 },
            ],
        };

        expect(() => handler.execute(overflowInput)).toThrow(
            RevenueShareOverflowError,
        );
    });
});