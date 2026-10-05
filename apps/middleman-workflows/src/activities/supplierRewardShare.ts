// Fraction of a claim's settlement amount that reaches the supplier under the relay
// mint=burn token logic module (poktroll x/tokenomics/token_logic_module/
// tlm_relay_burn_equals_mint.go, processRewardDistribution): the settlement amount is
// scaled by mint_ratio, and the supplier gets mint_equals_burn_claim_distribution.supplier
// of the result. mint_allocation_percentages only splits the global-mint inflation
// (tlm_global_mint.go, processMintDistribution), so it does not apply to claim rewards.
//
// Takes the raw `value` of the tokenomics-mint_equals_burn_claim_distribution and
// tokenomics-mint_ratio params as the indexer returns them, and throws if either is missing.
export function supplierRewardShare(
  claimDistributionValue: string | null | undefined,
  mintRatioValue: string | null | undefined,
): number {
  const supplier = claimDistributionValue
    ? (JSON.parse(claimDistributionValue) as { supplier?: number }).supplier
    : undefined
  const mintRatio = mintRatioValue ? Number(mintRatioValue) : undefined

  if (typeof supplier !== 'number' || !Number.isFinite(supplier)) {
    throw new Error('Failed to fetch mint_equals_burn_claim_distribution.supplier from indexer')
  }

  if (typeof mintRatio !== 'number' || !Number.isFinite(mintRatio)) {
    throw new Error('Failed to fetch mint_ratio from indexer')
  }

  return mintRatio * supplier
}

// Supplier rewards estimated from gross (settled) rewards, in upokt as a string.
export function supplierRewardAmount(grossRewards: number, share: number): string {
  return Math.floor(grossRewards * share).toString()
}
