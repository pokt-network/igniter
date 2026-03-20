import { RPCType, SupplierServiceConfig } from '@igniter/pocket/proto/pocket/shared/service';
import { Supplier, ServiceConfigUpdate } from '@igniter/pocket/proto/pocket/shared/supplier';
import {
  getSchemeForRpcType,
  getUrlTokenFromRpcType,
  getDefaultUrlWithSchemeByRpcType,
  getEndpointInterpolatedUrl,
  getSupplierActiveServices,
  getExpectedServicesFromKey,
} from './suppliers';

// ── getSchemeForRpcType ─────────────────────────────────────────────
describe('getSchemeForRpcType', () => {
  it('returns https for JSON_RPC', () => {
    expect(getSchemeForRpcType(RPCType.JSON_RPC)).toBe('https');
  });

  it('returns https for REST', () => {
    expect(getSchemeForRpcType(RPCType.REST)).toBe('https');
  });

  it('returns grpcs for GRPC', () => {
    expect(getSchemeForRpcType(RPCType.GRPC)).toBe('grpcs');
  });

  it('returns wss for WEBSOCKET', () => {
    expect(getSchemeForRpcType(RPCType.WEBSOCKET)).toBe('wss');
  });

  it('falls back to https for unknown RPC types', () => {
    expect(getSchemeForRpcType(RPCType.UNKNOWN_RPC)).toBe('https');
    expect(getSchemeForRpcType(RPCType.UNRECOGNIZED)).toBe('https');
  });
});

// ── getUrlTokenFromRpcType ──────────────────────────────────────────
describe('getUrlTokenFromRpcType', () => {
  it('returns json for JSON_RPC', () => {
    expect(getUrlTokenFromRpcType(RPCType.JSON_RPC)).toBe('json');
  });

  it('returns rest for REST', () => {
    expect(getUrlTokenFromRpcType(RPCType.REST)).toBe('rest');
  });

  it('returns grpc for GRPC', () => {
    expect(getUrlTokenFromRpcType(RPCType.GRPC)).toBe('grpc');
  });

  it('returns ws for WEBSOCKET', () => {
    expect(getUrlTokenFromRpcType(RPCType.WEBSOCKET)).toBe('ws');
  });

  it('falls back to json for unknown RPC types', () => {
    expect(getUrlTokenFromRpcType(RPCType.UNKNOWN_RPC)).toBe('json');
  });
});

// ── getDefaultUrlWithSchemeByRpcType ────────────────────────────────
describe('getDefaultUrlWithSchemeByRpcType', () => {
  it('replaces {scheme} with the correct scheme for JSON_RPC', () => {
    const url = getDefaultUrlWithSchemeByRpcType(RPCType.JSON_RPC);
    expect(url).toContain('https://');
    expect(url).not.toContain('{scheme}');
  });

  it('replaces {scheme} with grpcs for GRPC', () => {
    const url = getDefaultUrlWithSchemeByRpcType(RPCType.GRPC);
    expect(url).toContain('grpcs://');
  });
});

// ── getEndpointInterpolatedUrl ──────────────────────────────────────
describe('getEndpointInterpolatedUrl', () => {
  it('replaces all placeholders in the URL', () => {
    const endpoint = {
      rpcType: RPCType.JSON_RPC,
      url: 'https://{region}-{rm}-{sid}-{protocol}.{domain}',
    };
    const params = { sid: 'svc1', rm: 'miner1', region: 'us-east', domain: 'example.com' };
    const result = getEndpointInterpolatedUrl(endpoint, params);

    expect(result).toBe('https://us-east-miner1-svc1-json.example.com');
  });

  it('preserves unknown placeholders', () => {
    const endpoint = {
      rpcType: RPCType.JSON_RPC,
      url: 'https://{unknown}.example.com',
    };
    const params = { sid: 'svc1', rm: 'miner1', region: 'us-east', domain: 'example.com' };
    const result = getEndpointInterpolatedUrl(endpoint, params);

    expect(result).toBe('https://{unknown}.example.com');
  });

  it('uses default URL template when endpoint has no url', () => {
    const endpoint = {
      rpcType: RPCType.JSON_RPC,
      url: '',
    };
    const params = { sid: 'svc1', rm: 'miner1', region: 'us-east', domain: 'example.com' };
    const result = getEndpointInterpolatedUrl(endpoint, params);

    expect(result).toContain('us-east');
    expect(result).toContain('miner1');
    expect(result).toContain('svc1');
    expect(result).toContain('example.com');
  });

  it('injects the protocol token', () => {
    const endpoint = {
      rpcType: RPCType.GRPC,
      url: 'grpcs://{region}-{protocol}.{domain}',
    };
    const params = { sid: 'svc1', rm: 'miner1', region: 'eu', domain: 'test.io' };
    const result = getEndpointInterpolatedUrl(endpoint, params);

    expect(result).toBe('grpcs://eu-grpc.test.io');
  });
});

// ── getSupplierActiveServices ───────────────────────────────────────
describe('getSupplierActiveServices', () => {
  const svc = (id: string): SupplierServiceConfig => ({
    serviceId: id,
    endpoints: [],
    revShare: [],
  });

  const historyEntry = (
    service: SupplierServiceConfig,
    activationHeight: number,
    deactivationHeight: number,
  ): ServiceConfigUpdate => ({
    service,
    activationHeight,
    deactivationHeight,
  });

  it('returns all active services when no deactivations are scheduled', () => {
    const supplier = {
      services: [svc('A'), svc('B')],
      serviceConfigHistory: [],
    } as unknown as Supplier;

    const result = getSupplierActiveServices(supplier, 100);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.serviceId)).toEqual(['A', 'B']);
  });

  it('excludes services scheduled for deactivation after current height', () => {
    const serviceA = svc('A');
    const serviceB = svc('B');
    const supplier = {
      services: [serviceA, serviceB],
      serviceConfigHistory: [
        historyEntry(svc('A'), 50, 150), // deactivation at 150 > 100 → scheduled for removal
      ],
    } as unknown as Supplier;

    const result = getSupplierActiveServices(supplier, 100);
    expect(result.map((s) => s.serviceId)).toEqual(['B']);
  });

  it('includes services scheduled for activation after current height', () => {
    const supplier = {
      services: [svc('A')],
      serviceConfigHistory: [
        historyEntry(svc('C'), 200, 0), // activation at 200 > 100, no deactivation
      ],
    } as unknown as Supplier;

    const result = getSupplierActiveServices(supplier, 100);
    const ids = result.map((s) => s.serviceId);
    expect(ids).toContain('A');
    expect(ids).toContain('C');
  });

  it('excludes history entries that were deactivated before current height', () => {
    const supplier = {
      services: [svc('A')],
      serviceConfigHistory: [
        historyEntry(svc('C'), 200, 50), // deactivation at 50 <= 100 → removed before activation
      ],
    } as unknown as Supplier;

    const result = getSupplierActiveServices(supplier, 100);
    expect(result.map((s) => s.serviceId)).toEqual(['A']);
  });

  it('handles empty services and history', () => {
    const supplier = {
      services: [],
      serviceConfigHistory: [],
    } as unknown as Supplier;

    const result = getSupplierActiveServices(supplier, 100);
    expect(result).toHaveLength(0);
  });
});

// ── getExpectedServicesFromKey ───────────────────────────────────────
describe('getExpectedServicesFromKey', () => {
  it('builds expected services with delegator and owner rev share', () => {
    const key = {
      address: 'pokt1supplier',
      ownerAddress: 'pokt1owner',
      delegatorRewardsAddress: 'pokt1delegator',
      delegatorRevSharePercentage: 10,
      addressGroup: {
        relayMiner: { identity: 'rm1', domain: 'example.com', region: { urlValue: 'us' } },
        addressGroupServices: [
          {
            serviceId: 'svc1',
            addSupplierShare: false,
            supplierShare: 0,
            revShare: [{ address: 'pokt1provider', share: 20 }],
            service: {
              endpoints: [{ rpcType: RPCType.JSON_RPC, url: 'https://{region}.{domain}' }],
            },
          },
        ],
      },
    } as any;

    const result = getExpectedServicesFromKey(key);
    expect(result).toHaveLength(1);

    const svc = result[0]!;
    expect(svc.serviceId).toBe('svc1');

    // delegator=10, provider=20, owner=70
    expect(svc.revShare).toEqual(
      expect.arrayContaining([
        { address: 'pokt1delegator', revSharePercentage: 10 },
        { address: 'pokt1provider', revSharePercentage: 20 },
        { address: 'pokt1owner', revSharePercentage: 70 },
      ]),
    );
  });

  it('adds supplier share when addSupplierShare is true', () => {
    const key = {
      address: 'pokt1supplier',
      ownerAddress: 'pokt1owner',
      delegatorRewardsAddress: null,
      delegatorRevSharePercentage: null,
      addressGroup: {
        relayMiner: { identity: 'rm1', domain: 'example.com', region: { urlValue: 'us' } },
        addressGroupServices: [
          {
            serviceId: 'svc1',
            addSupplierShare: true,
            supplierShare: 15,
            revShare: [],
            service: {
              endpoints: [{ rpcType: RPCType.JSON_RPC, url: 'https://test.com' }],
            },
          },
        ],
      },
    } as any;

    const result = getExpectedServicesFromKey(key);
    const svc = result[0]!;

    // supplier=15, owner=85
    expect(svc.revShare).toEqual([
      { address: 'pokt1supplier', revSharePercentage: 15 },
      { address: 'pokt1owner', revSharePercentage: 85 },
    ]);
  });

  it('does not add owner share when rev shares already total 100%', () => {
    const key = {
      address: 'pokt1supplier',
      ownerAddress: 'pokt1owner',
      delegatorRewardsAddress: 'pokt1delegator',
      delegatorRevSharePercentage: 50,
      addressGroup: {
        relayMiner: { identity: 'rm1', domain: 'example.com', region: { urlValue: 'us' } },
        addressGroupServices: [
          {
            serviceId: 'svc1',
            addSupplierShare: true,
            supplierShare: 20,
            revShare: [{ address: 'pokt1provider', share: 30 }],
            service: {
              endpoints: [{ rpcType: RPCType.JSON_RPC, url: 'https://test.com' }],
            },
          },
        ],
      },
    } as any;

    const result = getExpectedServicesFromKey(key);
    const svc = result[0]!;

    // delegator=50, supplier=20, provider=30, total=100 → no owner entry
    expect(svc.revShare).toHaveLength(3);
    expect(svc.revShare.find((r) => r.address === 'pokt1owner')).toBeUndefined();
  });

  it('returns empty array when key has no address group services', () => {
    const key = {
      address: 'pokt1supplier',
      ownerAddress: 'pokt1owner',
      addressGroup: { addressGroupServices: [] },
    } as any;

    expect(getExpectedServicesFromKey(key)).toEqual([]);
  });
});
