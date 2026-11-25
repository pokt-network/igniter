'use server'

import { requireAuth } from '@/lib/utils/actions'
import {
  getChangesByNodeId,
  getRecentChangesByUser,
  acknowledgeChanges as dalAcknowledgeChanges,
  acknowledgeAllByNode as dalAcknowledgeAllByNode,
} from '@/lib/dal/supplierChanges'

export async function GetRecentChanges(page = 1, pageSize = 10) {
  const userIdentity = await requireAuth()
  return getRecentChangesByUser(userIdentity, page, pageSize)
}

export async function GetSupplierChanges(nodeId: number) {
  const userIdentity = await requireAuth()
  return getChangesByNodeId(nodeId, userIdentity)
}

export async function AcknowledgeChanges(changeIds: number[]) {
  const userIdentity = await requireAuth()
  return dalAcknowledgeChanges(changeIds, userIdentity)
}

export async function AcknowledgeAllByNode(nodeId: number) {
  const userIdentity = await requireAuth()
  return dalAcknowledgeAllByNode(nodeId, userIdentity)
}
