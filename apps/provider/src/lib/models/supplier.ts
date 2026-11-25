export interface SupplierStakeRequest {
  region?: number;
  addressGroupId: number;
  ownerAddress: string;
  revSharePercentage: number;
  delegatorAddress: string;
  items: StakeDistributionItem[];
}

export interface StakeDistributionItem {
  amount: number;
  qty: number;
}

export interface SupplierReleaseRequest {
  addresses: string[];
  /** The owner the keys were delivered to; only keys delivered to this owner are released. */
  ownerAddress: string;
}

export interface SupplierMarkStakedRequest {
  addresses: string[];
}

/**
 * Upper bound on the suppliers one signed request may ask for (sum of `qty` in a
 * stake distribution) or report (addresses in a stake/unstaking notification).
 */
export const MAX_SUPPLIERS_PER_REQUEST = 1000;

/** Upper bound on the entries of a stake distribution (middleman sends one per node size). */
export const MAX_STAKE_DISTRIBUTION_ITEMS = 10;
