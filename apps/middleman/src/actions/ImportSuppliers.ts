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
    })
  }

  if (nodesToInsert.length > 0) {
    await db
      .insert(nodesTable)
      .values(nodesToInsert)
      .onConflictDoNothing()
  }

  const importedAddresses = nodesToInsert.map((s) => s.address)
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
