'use server'

import { getNode, getNodesByUser, getOwnerAddressesByUser, getStakedNodesAddress } from '@/lib/dal/nodes'
import {getCurrentUserIdentity} from "@/lib/utils/actions";
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { normalizeIdentityToAddress } from '@/lib/crypto'

export async function GetUserNodes() {
  const userIdentity = await getCurrentUserIdentity();
  return getNodesByUser(userIdentity)
}

export async function GetStakedNodesAddress() {
  const [userIdentity, applicationSettings] = await Promise.all([
    getCurrentUserIdentity(),
    getApplicationSettings()
  ])

  // Normalize ownerIdentity in case it was stored as a hex public key (legacy)
  const normalizedOwnerIdentity = normalizeIdentityToAddress(applicationSettings.ownerIdentity)

  if (userIdentity !== normalizedOwnerIdentity) {
    throw new Error("Unauthorized")
  }

  return await getStakedNodesAddress()
}

export async function GetNode(address: string) {
  const [node, userIdentity] = await Promise.all([
    getNode(address),
    getCurrentUserIdentity()
  ])

  if (!node) {
    throw new Error("Node not found")
  }

  if (node.createdBy !== userIdentity) {
    throw new Error("Unauthorized")
  }

  return node
}

export async function GetOwnerAddresses() {
  const userIdentity = await getCurrentUserIdentity();
  return await getOwnerAddressesByUser(userIdentity)
}
