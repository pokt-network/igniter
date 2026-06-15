/** The expected on-chain effect of a supplier-mutating transaction, used for state-based verification. */
export type SupplierEffect =
  | { kind: 'stake-services-present'; ownerAddress: string }
  | { kind: 'upstake'; ownerAddress: string; minStakeUpokt: bigint }
  | { kind: 'unstake'; minSessionEndHeight: number }
