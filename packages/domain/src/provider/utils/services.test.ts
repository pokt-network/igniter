import { getRevShare } from './services';
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
