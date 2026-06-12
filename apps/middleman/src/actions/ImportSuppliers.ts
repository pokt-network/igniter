'use server'

import { requireAuth, assertOwnership } from '@/lib/utils/actions'
import {
  InsertImportSupplierAttempt, InsertNode,
  nodesTable,
} from '@igniter/db/middleman/schema'
import { ImportAttemptStatus, NodeStatus } from '@igniter/db/middleman/enums'
import * as importAttemptsDal from '@/lib/dal/importSupplierAttempts'
import { getDb } from '@/db'
import { ImportedSupplier } from '@/lib/services/importSuppliers'
import { getExistingNodes, getNodeAddressesByOwnerAndProvider } from '@/lib/dal/nodes'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'

async function getCurrentHeight(): Promise<number> {
  try {
    const settings = await getApplicationSettings()
    const pocketApiUrl = settings.pocketApiUrl?.replace(/\/$/, '')
    if (!pocketApiUrl) return 0
    const res = await fetch(`${pocketApiUrl}/cosmos/base/node/v1beta1/status`)
    if (!res.ok) return 0
    const data = await res.json()
    return parseInt(data.height, 10) || 0
  } catch {
    return 0
  }
}

/**
 * Fetches an import attempt and asserts it exists and is owned by the user.
 */
async function getOwnedImportAttempt(attemptId: number, userIdentity: string) {
  const attempt = await importAttemptsDal.getById(attemptId)
  assertOwnership(attempt, userIdentity, 'userIdentity', `Import attempt ${attemptId}`)
  return attempt
}

/**
 * Creates an audit record when an import is initiated.
 */
export async function CreateImportAttempt(
  ownerAddress: string,
  providerIdentity: string,
  providerId: number,
  nonce: string,
): Promise<number> {
  const userIdentity = await requireAuth()

  const attempt: InsertImportSupplierAttempt = {
    userIdentity,
    ownerAddress,
    providerIdentity,
    providerId,
    nonce,
    status: ImportAttemptStatus.Initiated,
  }

  const created = await importAttemptsDal.create(attempt)
  return created.id
}

/**
 * Updates the status of an import attempt.
 */
export async function UpdateImportAttemptStatus(
  attemptId: number,
  status: ImportAttemptStatus,
  data?: {
    signedAt?: Date
    submittedAt?: Date
    completedAt?: Date
    errorMessage?: string
  },
): Promise<void> {
  const userIdentity = await requireAuth()
  const attempt = await getOwnedImportAttempt(attemptId, userIdentity)

  if (attempt.status === ImportAttemptStatus.Submitted) {
    throw new Error(`Import attempt ${attemptId} already submitted. Cannot update status.`)
  }

  await importAttemptsDal.update(attemptId, {
    status,
    ...data,
  })
}

/**
 * Saves imported suppliers to the nodes table and marks the attempt as complete.
 */
export async function CompleteImportAttempt(
  attemptId: number,
  suppliers: ImportedSupplier[],
  providerIdentity: string,
): Promise<void> {
  const userIdentity = await requireAuth()
  const attempt = await getOwnedImportAttempt(attemptId, userIdentity)

  const db = getDb()
  const supplierAddresses = suppliers.map((s) => s.address)
  const existingSuppliers = await getExistingNodes(supplierAddresses, userIdentity)
  const height = await getCurrentHeight()

  const nodesToInsert: Array<InsertNode> = []

  for (const supplier of suppliers) {
    if (existingSuppliers.includes(supplier.address)) {
      continue
    }

    nodesToInsert.push({
      address: supplier.address,
      ownerAddress: attempt.ownerAddress,
      status: NodeStatus.Staked,
      stakeAmount: supplier.stakeAmount,
      providerId: providerIdentity,
      createdBy: attempt.userIdentity,
      balance: BigInt(0),
      lastUpdatedHeight: height,
    })
  }

  let importedAddresses: string[] = []
  if (nodesToInsert.length > 0) {
    // The nodes.address unique constraint silently drops rows whose address already
    // exists under ANOTHER user (getExistingNodes only sees this user's rows).
    // Derive the completed set from what actually landed.
    const inserted = await db
      .insert(nodesTable)
      .values(nodesToInsert)
      .onConflictDoNothing()
      .returning({ address: nodesTable.address })
    importedAddresses = inserted.map((r) => r.address)
    const dropped = nodesToInsert.filter((n) => !importedAddresses.includes(n.address))
    if (dropped.length > 0) {
      console.warn('CompleteImportAttempt: addresses skipped (already owned by another account)', dropped.map((n) => n.address))
    }
  }
  await importAttemptsDal.markCompleted(attemptId, importedAddresses)
}

/**
 * Cancels any pending import attempts for this owner+provider combination.
 */
export async function CancelPendingImportAttempts(
  ownerAddress: string,
  providerIdentity: string,
): Promise<void> {
  await importAttemptsDal.cancelPending(ownerAddress, providerIdentity)
}

/**
 * Gets the addresses of nodes already imported for this owner+provider combination.
 */
export async function GetExistingNodeAddressesByOwnerAndProvider(
  ownerAddress: string,
  providerIdentity: string,
): Promise<string[]> {
  const userIdentity = await requireAuth()
  return getNodeAddressesByOwnerAndProvider(ownerAddress, providerIdentity, userIdentity)
}
