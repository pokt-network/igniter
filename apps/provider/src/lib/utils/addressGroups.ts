import type { AddressGroup } from '@igniter/db/provider/schema'

/**
 * Whether a delegator may hand out keys of this address group to the given
 * owner: the group is not private, and it either has no linked addresses
 * ("visible to all delegators") or lists the owner among them.
 *
 * Mirrors the filter middleman applies before offering a group
 * (apps/middleman/src/actions/Stake.ts), so it refuses only what the UI never offers.
 */
export function isAddressGroupOpenTo(
  group: Pick<AddressGroup, 'private' | 'linkedAddresses'>,
  ownerAddress: string | null | undefined,
): boolean {
  if (group.private) return false

  const linked = group.linkedAddresses ?? []
  if (linked.length === 0) return true

  if (typeof ownerAddress !== 'string' || !ownerAddress) return false
  const owner = ownerAddress.toLowerCase()
  return linked.some((address) => address.toLowerCase() === owner)
}
