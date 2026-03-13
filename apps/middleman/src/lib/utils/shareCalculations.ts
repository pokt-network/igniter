type AddressGroupService = {
  addSupplierShare: boolean;
  supplierShare: number;
  revShare?: Array<{
    address: string;
    share: number;
  }>;
};

type AddressGroupRewards = {
  amount: string;
  staked_suppliers?: number;
  [key: string]: unknown;
};

type AddressGroup = {
  addressGroupServices: AddressGroupService[];
  grossRewardsPerService?: AddressGroupRewards[];
  rewardsSuppliersCount?: number;
  rewardsUpdatedAt?: string;
};

const REWARDS_STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

function isRewardsFresh(rewardsUpdatedAt: string | undefined): boolean {
  if (!rewardsUpdatedAt) return false;
  return Date.now() - new Date(rewardsUpdatedAt).getTime() < REWARDS_STALE_THRESHOLD_MS;
}

export interface ShareCalculation {
  providerShare: number;
  supplierShare: number;
  delegatorShare: number;
  clientShare: number;
}

export interface PerformanceResult {
  /** Average POKT per supplier per day over the last 7 days */
  value: number;
  /** True when only a subset of address groups had rewards data */
  isPartial: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Calculates share percentages for an address group.
 * Client Share is the median of per-service client shares.
 */
export function calculateShares(
  addressGroup: AddressGroup,
  delegatorFee: number
): ShareCalculation {
  const services = addressGroup.addressGroupServices || [];

  if (services.length === 0) {
    return {
      providerShare: 0,
      supplierShare: 0,
      delegatorShare: delegatorFee,
      clientShare: 100 - delegatorFee,
    };
  }

  // Compute per-service client shares for the median
  const perServiceClientShares = services.map((service) => {
    const providerShareForService =
      service.revShare?.reduce((acc, rev) => acc + rev.share, 0) ?? 0;
    const supplierShareForService = service.addSupplierShare
      ? service.supplierShare || 0
      : 0;
    return Math.max(
      0,
      100 - providerShareForService - supplierShareForService - delegatorFee
    );
  });

  // Averages kept for the breakdown display
  const totalProviderShare = services.reduce((sum, service) => {
    return sum + (service.revShare?.reduce((acc, rev) => acc + rev.share, 0) ?? 0);
  }, 0);
  const avgProviderShare = totalProviderShare / services.length;

  const servicesWithSupplierShare = services.filter((s) => s.addSupplierShare);
  const avgSupplierShare =
    servicesWithSupplierShare.length > 0
      ? servicesWithSupplierShare.reduce(
          (sum, s) => sum + (s.supplierShare || 0),
          0
        ) / servicesWithSupplierShare.length
      : 0;

  return {
    providerShare: avgProviderShare,
    supplierShare: avgSupplierShare,
    delegatorShare: delegatorFee,
    clientShare: median(perServiceClientShares),
  };
}

/**
 * Returns the average POKT per supplier per day for a single address group,
 * or null if rewards data is not yet available.
 *
 * Formula: sum(grossRewardsPerService[].amount) / rewardsSuppliersCount / 7
 */
export function calculateAddressGroupPerformance(
  addressGroup: AddressGroup
): number | null {
  if (
    !isRewardsFresh(addressGroup.rewardsUpdatedAt) ||
    !addressGroup.grossRewardsPerService ||
    addressGroup.grossRewardsPerService.length === 0
  ) {
    return null;
  }

  let total = 0;
  for (const entry of addressGroup.grossRewardsPerService) {
    const suppliers = entry.staked_suppliers || addressGroup.rewardsSuppliersCount;
    if (!suppliers) return null;
    total += parseFloat(entry.amount) / suppliers;
  }

  return total / 1e6 / 7;
}

/**
 * Aggregates performance across all address groups of a provider.
 * Returns null if no address group has rewards data yet.
 * Returns isPartial=true if only some address groups have data.
 *
 * Formula: sum(amounts across groups with data) / sum(suppliersCount across those groups) / 7
 */
export function calculateProviderPerformance(
  addressGroups: AddressGroup[]
): PerformanceResult | null {
  const withData = addressGroups.filter(
    (ag) =>
      isRewardsFresh(ag.rewardsUpdatedAt) &&
      ag.grossRewardsPerService &&
      ag.grossRewardsPerService.length > 0 &&
      ag.rewardsSuppliersCount &&
      ag.rewardsSuppliersCount > 0
  );

  if (withData.length === 0) return null;

  const totalAmount = withData.reduce((sum, ag) => {
    const agTotal = ag.grossRewardsPerService!.reduce(
      (s, e) => s + parseFloat(e.amount),
      0
    );
    return sum + agTotal;
  }, 0);

  const totalSuppliers = withData.reduce(
    (sum, ag) => sum + ag.rewardsSuppliersCount!,
    0
  );

  return {
    value: totalAmount / 1e6 / totalSuppliers / 7,
    isPartial: withData.length < addressGroups.length,
  };
}

/**
 * Returns the effective yield for a delegator:
 * performance × (clientShare / 100)
 * Returns null if performance data is unavailable.
 */
export function calculateEffectiveYield(
  performance: number | null,
  clientShare: number
): number | null {
  if (performance === null) return null;
  return performance * (clientShare / 100);
}

/** Formats a performance value as "X.XX POKT/supplier/day" */
export function formatPerformance(value: number): string {
  return `${value.toFixed(2)} POKT/supplier/day`;
}
