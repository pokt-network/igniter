/**
 * Realistic test fixtures for supplier service comparison tests.
 *
 * These fixtures use actual types from the proto-generated code and DB schema
 * to catch comparison bugs like the re-staking loop (see findings-supplier-restaking-loop.md).
 */
import type { Supplier, ServiceConfigUpdate } from '@igniter/pocket/proto/pocket/shared/supplier';
import type { SupplierServiceConfig } from '@igniter/pocket/proto/pocket/shared/service';
import { RPCType } from '@igniter/pocket/proto/pocket/shared/service';
import type { KeyWithGroup } from '@igniter/db/provider/schema';
import { KeyState } from '@igniter/db/provider/enums';

// ---------------------------------------------------------------------------
// Shared addresses
// ---------------------------------------------------------------------------
const OWNER_ADDRESS = 'pokt1owner7x9f3hqz5p8kn4d0e2c6wm7a1b9r3t5y8';
const OPERATOR_ADDRESS = 'pokt1oper8k2g4jd6h7m9w1c3f5n0b6v4r8q2s7t1e';
const DELEGATOR_ADDRESS = 'pokt1dele3a5c7m2n8x4k1p9f6b0v3r7w5q8s2t6y';
const PROVIDER_ADDRESS = 'pokt1prov4b6d8n3m9y1k2p7f5c0v6r8w4q1s3t5e';

// ---------------------------------------------------------------------------
// Helpers — build complete sub-objects without partial casts
// ---------------------------------------------------------------------------

function makeServiceConfig(
  serviceId: string,
  endpoints: SupplierServiceConfig['endpoints'],
  revShare: SupplierServiceConfig['revShare'],
): SupplierServiceConfig {
  return { serviceId, endpoints, revShare };
}

function makeSupplier(overrides: Partial<Supplier>): Supplier {
  return {
    ownerAddress: OWNER_ADDRESS,
    operatorAddress: OPERATOR_ADDRESS,
    stake: { denom: 'upokt', amount: '100000000' },
    services: [],
    unstakeSessionEndHeight: 0,
    serviceConfigHistory: [],
    ...overrides,
  };
}

function makeHistoryEntry(
  service: SupplierServiceConfig,
  activationHeight: number,
  deactivationHeight: number,
): ServiceConfigUpdate {
  return {
    operatorAddress: OPERATOR_ADDRESS,
    service,
    activationHeight,
    deactivationHeight,
  };
}

/**
 * Build a KeyWithGroup fixture. Fields not relevant to the test can be
 * filled with sensible defaults.  We use `as KeyWithGroup` because the
 * full Key type includes encrypted DB columns (privateKey, etc.) that
 * are irrelevant to the domain logic under test.
 */
function makeKeyWithGroup(overrides: Record<string, unknown>): KeyWithGroup {
  return {
    id: 1,
    address: OPERATOR_ADDRESS,
    publicKey: 'a'.repeat(66),
    privateKey: 'encrypted',
    ownerAddress: OWNER_ADDRESS,
    state: KeyState.Staked,
    remediationHistory: [],
    deliveredAt: null,
    deliveredTo: null,
    addressGroupId: 1,
    delegatorRevSharePercentage: 0,
    delegatorRewardsAddress: '',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    lastUpdatedHeight: 500,
    stakeOwner: OWNER_ADDRESS,
    stakeAmountUpokt: 100000000n,
    balanceUpokt: 50000000n,
    services: [],
    addressGroup: {
      id: 1,
      name: 'default-group',
      linkedAddresses: [],
      private: false,
      relayMinerId: 1,
      createdAt: new Date('2025-01-01'),
      createdBy: 'admin',
      updatedAt: new Date('2025-01-01'),
      updatedBy: 'admin',
      keysCount: 10,
      addressGroupServices: [],
      relayMiner: {
        id: 1,
        name: 'miner-us-east',
        identity: 'rm-us-east-01',
        regionId: 1,
        domain: 'relay.example.com',
        createdAt: new Date('2025-01-01'),
        createdBy: 'admin',
        updatedAt: new Date('2025-01-01'),
        updatedBy: 'admin',
        region: {
          id: 1,
          displayName: 'US East',
          urlValue: 'us-east',
          createdAt: new Date('2025-01-01'),
          createdBy: 'admin',
          updatedAt: new Date('2025-01-01'),
          updatedBy: 'admin',
        },
      },
    },
    ...overrides,
  } as KeyWithGroup;
}

// ---------------------------------------------------------------------------
// Shared service configs reused across fixtures
// ---------------------------------------------------------------------------

/** "anvil" service with a single JSON_RPC endpoint */
const anvilServiceConfig = makeServiceConfig(
  'anvil',
  [{ url: 'https://us-east-rm-us-east-01-anvil-json.relay.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
  [
    { address: PROVIDER_ADDRESS, revSharePercentage: 20 },
    { address: OWNER_ADDRESS, revSharePercentage: 80 },
  ],
);

/** "eth-mainnet" service with JSON_RPC and REST endpoints */
const ethMainnetServiceConfig = makeServiceConfig(
  'eth-mainnet',
  [
    { url: 'https://us-east-rm-us-east-01-eth-mainnet-json.relay.example.com', rpcType: RPCType.JSON_RPC, configs: [] },
    { url: 'https://us-east-rm-us-east-01-eth-mainnet-rest.relay.example.com', rpcType: RPCType.REST, configs: [] },
  ],
  [
    { address: PROVIDER_ADDRESS, revSharePercentage: 20 },
    { address: OWNER_ADDRESS, revSharePercentage: 80 },
  ],
);

// =========================================================================
// 1. matchingSupplierAndKey
// =========================================================================
/**
 * A Supplier whose services exactly match what getExpectedServicesFromKey
 * would produce from the paired KeyWithGroup.
 *
 * Services: anvil (JSON_RPC), eth-mainnet (JSON_RPC + REST)
 * RevShare: provider 20%, owner 80% (no delegator)
 */
export const matchingSupplierAndKey = {
  supplier: makeSupplier({
    services: [anvilServiceConfig, ethMainnetServiceConfig],
  }),

  key: makeKeyWithGroup({
    addressGroup: {
      id: 1,
      name: 'default-group',
      linkedAddresses: [],
      private: false,
      relayMinerId: 1,
      createdAt: new Date('2025-01-01'),
      createdBy: 'admin',
      updatedAt: new Date('2025-01-01'),
      updatedBy: 'admin',
      keysCount: 10,
      addressGroupServices: [
        {
          addressGroupId: 1,
          serviceId: 'anvil',
          addSupplierShare: false,
          supplierShare: 0,
          revShare: [{ address: PROVIDER_ADDRESS, share: 20 }],
          service: {
            name: 'Anvil',
            endpoints: [{ url: 'https://{region}-{rm}-{sid}-{protocol}.{domain}', rpcType: RPCType.JSON_RPC }],
          },
        },
        {
          addressGroupId: 1,
          serviceId: 'eth-mainnet',
          addSupplierShare: false,
          supplierShare: 0,
          revShare: [{ address: PROVIDER_ADDRESS, share: 20 }],
          service: {
            name: 'Ethereum Mainnet',
            endpoints: [
              { url: 'https://{region}-{rm}-{sid}-{protocol}.{domain}', rpcType: RPCType.JSON_RPC },
              { url: 'https://{region}-{rm}-{sid}-{protocol}.{domain}', rpcType: RPCType.REST },
            ],
          },
        },
      ],
      relayMiner: {
        id: 1,
        name: 'miner-us-east',
        identity: 'rm-us-east-01',
        regionId: 1,
        domain: 'relay.example.com',
        createdAt: new Date('2025-01-01'),
        createdBy: 'admin',
        updatedAt: new Date('2025-01-01'),
        updatedBy: 'admin',
        region: {
          id: 1,
          displayName: 'US East',
          urlValue: 'us-east',
          createdAt: new Date('2025-01-01'),
          createdBy: 'admin',
          updatedAt: new Date('2025-01-01'),
          updatedBy: 'admin',
        },
      },
    },
  }),
};

// =========================================================================
// 2. mismatchedSupplierAndKey
// =========================================================================
/**
 * A Supplier that is missing the "eth-mainnet" service and has a different
 * endpoint URL for "anvil" compared to what getExpectedServicesFromKey would
 * produce.
 */
export const mismatchedSupplierAndKey = {
  supplier: makeSupplier({
    services: [
      makeServiceConfig(
        'anvil',
        [{ url: 'https://old-endpoint.relay.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
        [
          { address: PROVIDER_ADDRESS, revSharePercentage: 20 },
          { address: OWNER_ADDRESS, revSharePercentage: 80 },
        ],
      ),
      // "eth-mainnet" is missing
    ],
  }),

  key: matchingSupplierAndKey.key, // same key expects both services
};

// =========================================================================
// 3. pristineSupplier
// =========================================================================
/**
 * OwnerInitialStake case: supplier was just created on-chain but has
 * zero services and no config history.
 */
export const pristineSupplier = makeSupplier({
  services: [],
  serviceConfigHistory: [],
});

// =========================================================================
// 4. zeroRevShareKey
// =========================================================================
/**
 * PRIMARY CAUSE OF THE RE-STAKING LOOP:
 * delegatorRevSharePercentage = 0 with a delegatorRewardsAddress set.
 *
 * getExpectedServicesFromKey includes the 0% entry in revShare,
 * but BuildSupplierServiceConfigHandler filters entries with
 * revSharePercentage === 0.  This mismatch between expected and
 * actual causes CompareSupplierServiceConfigHandler to report
 * isEqual: false, triggering a needless re-stake every cycle.
 */
export const zeroRevShareKey = makeKeyWithGroup({
  delegatorRevSharePercentage: 0,
  delegatorRewardsAddress: DELEGATOR_ADDRESS,
  addressGroup: {
    id: 1,
    name: 'default-group',
    linkedAddresses: [],
    private: false,
    relayMinerId: 1,
    createdAt: new Date('2025-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2025-01-01'),
    updatedBy: 'admin',
    keysCount: 10,
    addressGroupServices: [
      {
        addressGroupId: 1,
        serviceId: 'anvil',
        addSupplierShare: false,
        supplierShare: 0,
        revShare: [{ address: PROVIDER_ADDRESS, share: 20 }],
        service: {
          name: 'Anvil',
          endpoints: [{ url: 'https://{region}-{rm}-{sid}-{protocol}.{domain}', rpcType: RPCType.JSON_RPC }],
        },
      },
    ],
    relayMiner: {
      id: 1,
      name: 'miner-us-east',
      identity: 'rm-us-east-01',
      regionId: 1,
      domain: 'relay.example.com',
      createdAt: new Date('2025-01-01'),
      createdBy: 'admin',
      updatedAt: new Date('2025-01-01'),
      updatedBy: 'admin',
      region: {
        id: 1,
        displayName: 'US East',
        urlValue: 'us-east',
        createdAt: new Date('2025-01-01'),
        createdBy: 'admin',
        updatedAt: new Date('2025-01-01'),
        updatedBy: 'admin',
      },
    },
  },
});

// =========================================================================
// 5. multiGenerationHistory
// =========================================================================
/**
 * Supplier with complex serviceConfigHistory:
 * - "anvil" activated at height 100, still active (no deactivation)
 * - "eth-mainnet" activated at height 100, deactivated at height 200
 * - "eth-mainnet" new config activated at height 200 (replacement)
 * - "solana-mainnet" pending activation at height 300 (not yet active)
 *
 * Current services array contains the currently active configs.
 */
const ethMainnetOldConfig = makeServiceConfig(
  'eth-mainnet',
  [{ url: 'https://old-eth.relay.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
  [{ address: OWNER_ADDRESS, revSharePercentage: 100 }],
);

const ethMainnetNewConfig = makeServiceConfig(
  'eth-mainnet',
  [{ url: 'https://us-east-rm-us-east-01-eth-mainnet-json.relay.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
  [
    { address: PROVIDER_ADDRESS, revSharePercentage: 20 },
    { address: OWNER_ADDRESS, revSharePercentage: 80 },
  ],
);

const solanaPendingConfig = makeServiceConfig(
  'solana-mainnet',
  [{ url: 'https://us-east-rm-us-east-01-solana-mainnet-json.relay.example.com', rpcType: RPCType.JSON_RPC, configs: [] }],
  [{ address: OWNER_ADDRESS, revSharePercentage: 100 }],
);

export const multiGenerationHistory = makeSupplier({
  services: [anvilServiceConfig, ethMainnetNewConfig],
  serviceConfigHistory: [
    // anvil activated at 100, still active
    makeHistoryEntry(anvilServiceConfig, 100, 0),
    // old eth-mainnet activated at 100, deactivated at 200
    makeHistoryEntry(ethMainnetOldConfig, 100, 200),
    // new eth-mainnet config activated at 200, still active
    makeHistoryEntry(ethMainnetNewConfig, 200, 0),
    // solana-mainnet pending activation at 300
    makeHistoryEntry(solanaPendingConfig, 300, 0),
  ],
});

// =========================================================================
// 6. deactivatedServicesSupplier
// =========================================================================
/**
 * Supplier where "eth-mainnet" is scheduled for deactivation at height 250.
 * At height 200, this should be excluded from active services.
 * "anvil" remains active.
 */
export const deactivatedServicesSupplier = makeSupplier({
  services: [anvilServiceConfig, ethMainnetServiceConfig],
  serviceConfigHistory: [
    // eth-mainnet is scheduled for deactivation at 250 (> current height)
    makeHistoryEntry(ethMainnetServiceConfig, 100, 250),
  ],
});

// =========================================================================
// 7. emptyOwnerKey
// =========================================================================
/**
 * A KeyWithGroup where ownerAddress is empty string (legacy key that was
 * imported before the ownerAddress field was backfilled).
 * The paired Supplier has a valid ownerAddress on-chain.
 *
 * This tests the owner-remainder revShare calculation: when ownerAddress
 * is empty, the remainder entry should NOT be added.
 */
export const emptyOwnerKey = makeKeyWithGroup({
  ownerAddress: '',
  addressGroup: {
    id: 1,
    name: 'default-group',
    linkedAddresses: [],
    private: false,
    relayMinerId: 1,
    createdAt: new Date('2025-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2025-01-01'),
    updatedBy: 'admin',
    keysCount: 10,
    addressGroupServices: [
      {
        addressGroupId: 1,
        serviceId: 'anvil',
        addSupplierShare: false,
        supplierShare: 0,
        revShare: [{ address: PROVIDER_ADDRESS, share: 20 }],
        service: {
          name: 'Anvil',
          endpoints: [{ url: 'https://{region}-{rm}-{sid}-{protocol}.{domain}', rpcType: RPCType.JSON_RPC }],
        },
      },
    ],
    relayMiner: {
      id: 1,
      name: 'miner-us-east',
      identity: 'rm-us-east-01',
      regionId: 1,
      domain: 'relay.example.com',
      createdAt: new Date('2025-01-01'),
      createdBy: 'admin',
      updatedAt: new Date('2025-01-01'),
      updatedBy: 'admin',
      region: {
        id: 1,
        displayName: 'US East',
        urlValue: 'us-east',
        createdAt: new Date('2025-01-01'),
        createdBy: 'admin',
        updatedAt: new Date('2025-01-01'),
        updatedBy: 'admin',
      },
    },
  },
});

// Re-export addresses for use in assertions
export {
  OWNER_ADDRESS,
  OPERATOR_ADDRESS,
  DELEGATOR_ADDRESS,
  PROVIDER_ADDRESS,
};
