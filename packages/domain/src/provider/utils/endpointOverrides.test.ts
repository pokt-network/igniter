import {RPCType} from '@igniter/pocket/proto/pocket/shared/service';
import {
  getEndpointOverride,
  getExpectedServicesFromKey,
  normalizeRpcType,
} from './suppliers';

describe('endpoint override compatibility', () => {
  it.each([
    [RPCType.REST, RPCType.REST],
    ['4', RPCType.REST],
    ['REST', RPCType.REST],
    ['JSON_RPC', RPCType.JSON_RPC],
  ])('normalizes rpc type %s', (input, expected) => {
    expect(normalizeRpcType(input)).toBe(expected);
  });

  it('prefers the raw legacy key when both formats exist', () => {
    expect(
      getEndpointOverride(
        {
          REST: 'https://legacy.example.com',
          '4': 'https://numeric.example.com',
        },
        'REST',
      ),
    ).toBe('https://legacy.example.com');
  });

  it('falls back to the normalized numeric key', () => {
    expect(
      getEndpointOverride(
        {'4': 'https://numeric.example.com'},
        'REST',
      ),
    ).toBe('https://numeric.example.com');
  });

  const makeKey = (endpointOverrides?: Record<string, string>) => ({
    address: 'pokt1supplier',
    ownerAddress: 'pokt1owner',
    delegatorRewardsAddress: null,
    delegatorRevSharePercentage: null,
    addressGroup: {
      relayMiner: {
        identity: 'rm1',
        domain: 'example.com',
        region: {urlValue: 'us'},
      },
      addressGroupServices: [
        {
          serviceId: 'svc1',
          addSupplierShare: false,
          supplierShare: 0,
          revShare: [],
          endpointOverrides,
          service: {
            endpoints: [
              {
                rpcType: 'REST',
                url: 'https://{protocol}.example.com',
              },
            ],
          },
        },
      ],
    },
  }) as any;

  it.each([
    [{'4': 'https://numeric.example.com'}, 'https://numeric.example.com'],
    [{REST: 'https://legacy.example.com'}, 'https://legacy.example.com'],
  ])('applies endpoint overrides from either key format', (overrides, expectedUrl) => {
    const [service] = getExpectedServicesFromKey(makeKey(overrides));

    expect(service?.endpoints[0]).toEqual({
      url: expectedUrl,
      rpcType: RPCType.REST,
      configs: [],
    });
  });

  it('keeps existing protocol interpolation while normalizing emitted rpcType', () => {
    const [service] = getExpectedServicesFromKey(makeKey());

    expect(service?.endpoints[0]).toEqual({
      url: 'https://json.example.com',
      rpcType: RPCType.REST,
      configs: [],
    });
  });
});
