import { ChainId } from '@igniter/db/middleman/enums'

/**
 * Public block explorer, keyed by chain. Mainnet lives at the root and beta under
 * a path prefix. 'pocket-lego-testnet' is the beta network's chain id, so both
 * ids resolve to the same explorer. Alpha has no public explorer: callers get
 * null and render plain text instead of a dead link.
 */
const EXPLORER_BASE_BY_CHAIN: Partial<Record<ChainId, string>> = {
  [ChainId.Pocket]: 'https://explorer.pocket.network',
  [ChainId.PocketBeta]: 'https://explorer.pocket.network/beta',
  [ChainId.PocketTestnet]: 'https://explorer.pocket.network/beta',
}

export function explorerBaseUrl(chainId: string | undefined): string | null {
  if (!chainId) return null
  return EXPLORER_BASE_BY_CHAIN[chainId as ChainId] ?? null
}

export function explorerAccountUrl(chainId: string | undefined, address: string): string | null {
  const base = explorerBaseUrl(chainId)
  return base ? `${base}/account/${address}` : null
}

export function explorerValidatorUrl(chainId: string | undefined, operatorAddress: string): string | null {
  const base = explorerBaseUrl(chainId)
  return base ? `${base}/validator/${operatorAddress}` : null
}
