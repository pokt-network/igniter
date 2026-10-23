// Transaction pages on the Pocket explorer, by the app's chainId setting. Beta and the lego testnet
// are the same network on the explorer; pocket-alpha has no explorer, so its hashes are not linked.
const EXPLORER_TX_BASE: Record<string, string> = {
  'pocket': 'https://explorer.pocket.network/tx/',
  'pocket-beta': 'https://explorer.pocket.network/beta/tx/',
  'pocket-lego-testnet': 'https://explorer.pocket.network/beta/tx/',
}

export function explorerTxUrl(chainId: string | null | undefined, hash: string): string | null {
  const base = chainId ? EXPLORER_TX_BASE[chainId] : undefined
  return base && hash ? `${base}${hash}` : null
}
