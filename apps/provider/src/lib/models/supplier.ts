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
}

export interface SupplierMarkStakedRequest {
  addresses: string[];
}
