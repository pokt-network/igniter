'use server'

import { getNode, getNodesByUser, getOwnerAddressesByUser, getStakedNodesAddress } from '@/lib/dal/nodes'
import { requireAuth, assertOwnership } from "@/lib/utils/actions";
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { normalizeIdentityToAddress } from '@/lib/crypto'

export async function GetUserNodes() {
  const userIdentity = await requireAuth()
  return getNodesByUser(userIdentity)
}

export async function GetStakedNodesAddress() {
  const [userIdentity, applicationSettings] = await Promise.all([
    requireAuth(),
    getApplicationSettings()
  ])

  const normalizedOwnerIdentity = normalizeIdentityToAddress(applicationSettings.ownerIdentity)

  if (userIdentity !== normalizedOwnerIdentity) {
    throw new Error("Unauthorized")
  }

  return await getStakedNodesAddress()
}

export async function GetNode(address: string) {
  const [node, userIdentity] = await Promise.all([
    getNode(address),
    requireAuth()
  ])

  assertOwnership(node, userIdentity, 'createdBy', 'Node')
  return node
}

export async function GetOwnerAddresses() {
  const userIdentity = await requireAuth()
  return await getOwnerAddressesByUser(userIdentity)
}
