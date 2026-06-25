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

/**
 * Tolerance (in percentage points) below which two per-service client shares
 * are treated as equal. Guards against float dust from the share arithmetic.
 */
const CLIENT_SHARE_UNIFORM_EPSILON = 0.05;

/**
 * Per-service client share = the clamped remainder
 * `100 − providerForService − supplierForService − delegatorFee`.
 * This is the single source of truth for "what the client/owner keeps on this
 * service"; callers (aggregation, uniformity check, per-service table) reuse it.
 */
export function getPerServiceClientShares(
  addressGroup: AddressGroup,
  delegatorFee: number
): number[] {
  const services = addressGroup.addressGroupServices || [];
  return services.map((service) => {
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
}

/**
 * True when a plan's services do NOT all yield the same client share.
 *
 * This is exactly the case where an aggregated 4-row breakdown cannot reconcile
 * to 100%, so callers should show per-service detail instead of one number
 * (issue #305). Per the agreed trigger, this compares the client-share
 * *remainder* only — shifting the provider/supplier split between services while
 * the client share stays equal is intentionally NOT flagged.
 */
export function hasNonUniformClientShare(
  addressGroup: AddressGroup,
  delegatorFee: number
): boolean {
  const shares = getPerServiceClientShares(addressGroup, delegatorFee);
  if (shares.length <= 1) return false;
  return Math.max(...shares) - Math.min(...shares) > CLIENT_SHARE_UNIFORM_EPSILON;
}

/**
 * Calculates aggregated share percentages for an address group.
 *
 * Provider/Supplier are averaged across services; Client is the reconciling
 * remainder `100 − provider − supplier − delegator`, so the four rows always
 * sum to 100. This aggregate is only meaningful to display when the plan's
 * per-service client shares are uniform — see {@link hasNonUniformClientShare}.
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

  // Client is the reconciling remainder of the displayed rows, clamped to 0.
  const clientShare = Math.max(
    0,
    100 - avgProviderShare - avgSupplierShare - delegatorFee
  );

  return {
    providerShare: avgProviderShare,
    supplierShare: avgSupplierShare,
    delegatorShare: delegatorFee,
    clientShare,
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
