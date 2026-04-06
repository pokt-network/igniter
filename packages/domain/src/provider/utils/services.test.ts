import { getRevShare, deduplicateRevShare } from './services';
import type { AddressGroupService } from '@igniter/db/provider/schema';

describe('getRevShare', () => {
  it('maps rev shares from address group service', () => {
    const ags = {
      revShare: [
        { address: 'pokt1alice', share: 30 },
        { address: 'pokt1bob', share: 20 },
      ],
      addSupplierShare: false,
      supplierShare: null,
    } as unknown as AddressGroupService;

    const result = getRevShare(ags, 'pokt1operator');
    expect(result).toEqual([
      { address: 'pokt1alice', revSharePercentage: 30 },
      { address: 'pokt1bob', revSharePercentage: 20 },
    ]);
  });

  it('adds operator share when addSupplierShare is true', () => {
    const ags = {
      revShare: [{ address: 'pokt1alice', share: 30 }],
      addSupplierShare: true,
      supplierShare: 15,
    } as unknown as AddressGroupService;

    const result = getRevShare(ags, 'pokt1operator');
    expect(result).toEqual([
      { address: 'pokt1alice', revSharePercentage: 30 },
      { address: 'pokt1operator', revSharePercentage: 15 },
    ]);
  });

  it('returns empty array when no rev shares exist and addSupplierShare is false', () => {
    const ags = {
      revShare: [],
      addSupplierShare: false,
      supplierShare: null,
    } as unknown as AddressGroupService;

    const result = getRevShare(ags, 'pokt1operator');
    expect(result).toEqual([]);
  });

  it('returns only operator share when revShare is empty but addSupplierShare is true', () => {
    const ags = {
      revShare: [],
      addSupplierShare: true,
      supplierShare: 10,
    } as unknown as AddressGroupService;

    const result = getRevShare(ags, 'pokt1operator');
    expect(result).toEqual([{ address: 'pokt1operator', revSharePercentage: 10 }]);
  });
});

describe('deduplicateRevShare', () => {
  it('sums percentages for duplicate addresses', () => {
    const result = deduplicateRevShare([
      { address: 'pokt1owner', revSharePercentage: 10 },
      { address: 'pokt1other', revSharePercentage: 1 },
      { address: 'pokt1owner', revSharePercentage: 89 },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { address: 'pokt1owner', revSharePercentage: 99 },
        { address: 'pokt1other', revSharePercentage: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('is case-insensitive when matching addresses', () => {
    const result = deduplicateRevShare([
      { address: 'pokt1OWNER', revSharePercentage: 10 },
      { address: 'pokt1owner', revSharePercentage: 89 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.revSharePercentage).toBe(99);
  });

  it('returns unchanged array when all addresses are unique', () => {
    const input = [
      { address: 'pokt1alice', revSharePercentage: 20 },
      { address: 'pokt1bob', revSharePercentage: 80 },
    ];
    const result = deduplicateRevShare(input);
    expect(result).toEqual(input);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateRevShare([])).toEqual([]);
  });
});
