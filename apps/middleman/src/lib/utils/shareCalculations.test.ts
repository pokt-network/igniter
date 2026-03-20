import {
  calculateShares,
  calculateAddressGroupPerformance,
  calculateProviderPerformance,
  calculateEffectiveYield,
  formatPerformance,
} from './shareCalculations';

// ── calculateShares ─────────────────────────────────────────────────
describe('calculateShares', () => {
  it('returns correct shares for a single service', () => {
    const ag = {
      addressGroupServices: [
        {
          addSupplierShare: true,
          supplierShare: 10,
          revShare: [{ address: 'pokt1prov', share: 20 }],
        },
      ],
    };

    const result = calculateShares(ag, 5);
    expect(result.delegatorShare).toBe(5);
    expect(result.providerShare).toBe(20);
    expect(result.supplierShare).toBe(10);
    // client = 100 - 20 - 10 - 5 = 65
    expect(result.clientShare).toBe(65);
  });

  it('returns delegator + client shares when no services exist', () => {
    const ag = { addressGroupServices: [] };
    const result = calculateShares(ag, 8);

    expect(result.providerShare).toBe(0);
    expect(result.supplierShare).toBe(0);
    expect(result.delegatorShare).toBe(8);
    expect(result.clientShare).toBe(92);
  });

  it('uses median for client share across multiple services', () => {
    const ag = {
      addressGroupServices: [
        { addSupplierShare: false, supplierShare: 0, revShare: [{ address: 'a', share: 10 }] },
        { addSupplierShare: false, supplierShare: 0, revShare: [{ address: 'b', share: 30 }] },
        { addSupplierShare: false, supplierShare: 0, revShare: [{ address: 'c', share: 50 }] },
      ],
    };

    const result = calculateShares(ag, 0);
    // Per-service client shares: 90, 70, 50 → median = 70
    expect(result.clientShare).toBe(70);
  });

  it('averages provider share across services', () => {
    const ag = {
      addressGroupServices: [
        { addSupplierShare: false, supplierShare: 0, revShare: [{ address: 'a', share: 10 }] },
        { addSupplierShare: false, supplierShare: 0, revShare: [{ address: 'b', share: 30 }] },
      ],
    };

    const result = calculateShares(ag, 0);
    expect(result.providerShare).toBe(20); // (10+30)/2
  });

  it('averages supplier share only across services that enable it', () => {
    const ag = {
      addressGroupServices: [
        { addSupplierShare: true, supplierShare: 20, revShare: [] },
        { addSupplierShare: false, supplierShare: 0, revShare: [] },
        { addSupplierShare: true, supplierShare: 10, revShare: [] },
      ],
    };

    const result = calculateShares(ag, 0);
    expect(result.supplierShare).toBe(15); // (20+10)/2
  });

  it('clamps client share to 0 when other shares exceed 100%', () => {
    const ag = {
      addressGroupServices: [
        { addSupplierShare: true, supplierShare: 60, revShare: [{ address: 'a', share: 50 }] },
      ],
    };

    const result = calculateShares(ag, 0);
    expect(result.clientShare).toBe(0);
  });
});

// ── calculateAddressGroupPerformance ─────────────────────────────
describe('calculateAddressGroupPerformance', () => {
  it('returns correct performance value', () => {
    const ag = {
      addressGroupServices: [],
      grossRewardsPerService: [
        { amount: '7000000', staked_suppliers: 1 }, // 7 POKT over 7 days
      ],
      rewardsSuppliersCount: 1,
      rewardsUpdatedAt: new Date().toISOString(),
    };

    const result = calculateAddressGroupPerformance(ag);
    // 7_000_000 / 1 supplier / 1e6 / 7 = 1.0
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns null when rewards data is stale (>48h)', () => {
    const staleDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    const ag = {
      addressGroupServices: [],
      grossRewardsPerService: [{ amount: '7000000', staked_suppliers: 1 }],
      rewardsSuppliersCount: 1,
      rewardsUpdatedAt: staleDate,
    };

    expect(calculateAddressGroupPerformance(ag)).toBeNull();
  });

  it('returns null when no rewards data exists', () => {
    const ag = {
      addressGroupServices: [],
      grossRewardsPerService: [],
      rewardsSuppliersCount: 0,
      rewardsUpdatedAt: new Date().toISOString(),
    };

    expect(calculateAddressGroupPerformance(ag)).toBeNull();
  });

  it('returns null when rewardsUpdatedAt is undefined', () => {
    const ag = {
      addressGroupServices: [],
      grossRewardsPerService: [{ amount: '1000000' }],
      rewardsSuppliersCount: 1,
    };

    expect(calculateAddressGroupPerformance(ag)).toBeNull();
  });

  it('uses staked_suppliers from entry when available', () => {
    const ag = {
      addressGroupServices: [],
      grossRewardsPerService: [
        { amount: '14000000', staked_suppliers: 2 },
      ],
      rewardsSuppliersCount: 10, // should be ignored in favor of staked_suppliers
      rewardsUpdatedAt: new Date().toISOString(),
    };

    const result = calculateAddressGroupPerformance(ag);
    // 14_000_000 / 2 / 1e6 / 7 = 1.0
    expect(result).toBeCloseTo(1.0, 5);
  });
});

// ── calculateProviderPerformance ────────────────────────────────
describe('calculateProviderPerformance', () => {
  it('aggregates across groups with data', () => {
    const now = new Date().toISOString();
    const groups = [
      {
        addressGroupServices: [],
        grossRewardsPerService: [{ amount: '7000000' }],
        rewardsSuppliersCount: 1,
        rewardsUpdatedAt: now,
      },
      {
        addressGroupServices: [],
        grossRewardsPerService: [{ amount: '14000000' }],
        rewardsSuppliersCount: 2,
        rewardsUpdatedAt: now,
      },
    ];

    const result = calculateProviderPerformance(groups);
    expect(result).not.toBeNull();
    // (7_000_000 + 14_000_000) / 1e6 / (1+2) / 7 = 21/3/7 = 1.0
    expect(result!.value).toBeCloseTo(1.0, 5);
    expect(result!.isPartial).toBe(false);
  });

  it('returns isPartial=true when only some groups have data', () => {
    const now = new Date().toISOString();
    const groups = [
      {
        addressGroupServices: [],
        grossRewardsPerService: [{ amount: '7000000' }],
        rewardsSuppliersCount: 1,
        rewardsUpdatedAt: now,
      },
      {
        addressGroupServices: [],
        grossRewardsPerService: [],
        rewardsSuppliersCount: 0,
        rewardsUpdatedAt: now,
      },
    ];

    const result = calculateProviderPerformance(groups);
    expect(result).not.toBeNull();
    expect(result!.isPartial).toBe(true);
  });

  it('returns null when no groups have data', () => {
    const groups = [
      { addressGroupServices: [], grossRewardsPerService: [], rewardsSuppliersCount: 0 },
    ];

    expect(calculateProviderPerformance(groups)).toBeNull();
  });
});

// ── calculateEffectiveYield ─────────────────────────────────────
describe('calculateEffectiveYield', () => {
  it('returns performance * clientShare / 100', () => {
    expect(calculateEffectiveYield(2.0, 50)).toBeCloseTo(1.0, 5);
  });

  it('returns null when performance is null', () => {
    expect(calculateEffectiveYield(null, 50)).toBeNull();
  });

  it('returns 0 when clientShare is 0', () => {
    expect(calculateEffectiveYield(5.0, 0)).toBe(0);
  });
});

// ── formatPerformance ───────────────────────────────────────────
describe('formatPerformance', () => {
  it('formats value with two decimal places', () => {
    expect(formatPerformance(1.5)).toBe('1.50 POKT/supplier/day');
  });

  it('formats zero', () => {
    expect(formatPerformance(0)).toBe('0.00 POKT/supplier/day');
  });

  it('rounds to two decimal places', () => {
    expect(formatPerformance(1.999)).toBe('2.00 POKT/supplier/day');
  });
});
