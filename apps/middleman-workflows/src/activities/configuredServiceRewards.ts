// Service ids are compared trimmed and lower-cased. The chain's ids are case-sensitive
// (poktroll x/shared/types/service.go allows [a-zA-Z0-9_-]), but none of mainnet's or beta's
// differ only by case, while an address group's ids can come from the provider's bootstrap
// config, which is not checked against the chain.
function normalizeServiceId(serviceId: string): string {
  return serviceId.trim().toLowerCase()
}

// Keeps only the rewards of the services configured in the address group: the domain-level
// query returns every service the group's relay miner domains served, including services
// another group (or another operator on the same domain) runs.
export function configuredServiceRewards<T extends { service_id: string }>(
  rewards: Array<T>,
  configuredServiceIds: Array<string>,
): Array<T> {
  const configured = new Set(configuredServiceIds.map(normalizeServiceId))
  return rewards.filter((r) => configured.has(normalizeServiceId(r.service_id)))
}
