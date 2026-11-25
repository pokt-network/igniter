'use server'

import { z } from 'zod'
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
import { getLogger } from '@igniter/logger'
import { runWithRequestContext } from '@/lib/logging/withLogging'
import { governance } from '@/lib/governance'
import { getChainSupplier, getProviderImportStatus } from '@/lib/importSuppliersVerification'
import { isPoktAddress } from '@/lib/utils/address'

const log = getLogger(['middleman', 'import-suppliers'])

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
  return runWithRequestContext(async () => {
    const userIdentity = await requireAuth()

    // The provider identity comes from the client: only a provider in the governance source is accepted.
    if (!(await governance.resolve(providerIdentity))) {
      throw new Error('The provider is not in the governance source')
    }

    const attempt: InsertImportSupplierAttempt = {
      userIdentity,
      ownerAddress,
      providerIdentity,
      providerId,
      nonce,
      status: ImportAttemptStatus.Initiated,
    }

    const created = await importAttemptsDal.create(attempt)
    log.info('import attempt created', { attemptId: created.id, ownerAddress, providerIdentity })
    return created.id
  })
}

// Completed is not settable here: only CompleteImportAttempt reaches it, from the provider's answer.
const UpdateImportAttemptStatusSchema = z.object({
  status: z.nativeEnum(ImportAttemptStatus).refine((s) => s !== ImportAttemptStatus.Completed, {
    message: 'An import attempt is completed only from the provider result',
  }),
  data: z.object({
    signedAt: z.date().optional(),
    submittedAt: z.date().optional(),
    completedAt: z.date().optional(),
    errorMessage: z.string().max(1000).optional(),
  }).strict().optional(),
}).strict()

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
  return runWithRequestContext(async () => {
    const userIdentity = await requireAuth()
    const input = UpdateImportAttemptStatusSchema.parse({ status, data })
    const attempt = await getOwnedImportAttempt(attemptId, userIdentity)

    if (attempt.status === ImportAttemptStatus.Submitted) {
      throw new Error(`Import attempt ${attemptId} already submitted. Cannot update status.`)
    }

    // Field by field: nothing the client sends beyond these reaches the update.
    await importAttemptsDal.update(attemptId, {
      status: input.status,
      ...(input.data?.signedAt !== undefined && { signedAt: input.data.signedAt }),
      ...(input.data?.submittedAt !== undefined && { submittedAt: input.data.submittedAt }),
      ...(input.data?.completedAt !== undefined && { completedAt: input.data.completedAt }),
      ...(input.data?.errorMessage !== undefined && { errorMessage: input.data.errorMessage }),
    })
    log.info('import attempt status updated', { attemptId, status: input.status })
  })
}

/**
 * Saves imported suppliers to the nodes table and marks the attempt as complete.
 *
 * The client's list only narrows what is saved. A supplier is saved when the provider, asked here
 * by this server for this attempt's nonce, answers the import completed with it, and the chain
 * says the attempt's owner owns it; its stake amount is the chain's.
 */
export async function CompleteImportAttempt(
  attemptId: number,
  suppliers: ImportedSupplier[],
  // Ignored: the provider is the one recorded on the owned attempt (checked against the
  // governance source when the attempt was created), not one the client sends now.
  _providerIdentity: string,
): Promise<void> {
  return runWithRequestContext(async () => {
    const userIdentity = await requireAuth()
    const attempt = await getOwnedImportAttempt(attemptId, userIdentity)

    // The recovery workflow completes submitted attempts too; whichever lands second has nothing to do.
    if (attempt.status === ImportAttemptStatus.Completed) {
      log.info('import attempt already completed', { attemptId })
      return
    }
    if (attempt.status !== ImportAttemptStatus.Submitted) {
      throw new Error(`Import attempt ${attemptId} was not submitted. Cannot complete it.`)
    }
    // Without a nonce the provider answers the latest request for the owner, which may not be this one.
    if (!attempt.nonce) {
      throw new Error(`Import attempt ${attemptId} has no nonce. Cannot complete it.`)
    }

    const governed = await governance.resolve(attempt.providerIdentity)
    if (!governed) {
      throw new Error('The provider is not in the governance source')
    }

    const settings = await getApplicationSettings()
    const providerStatus = await getProviderImportStatus(governed.url, settings.appIdentity, {
      ownerAddress: attempt.ownerAddress,
      nonce: attempt.nonce,
    })
    if (providerStatus.status !== 'completed') {
      throw new Error(`The provider has not completed this import (status: ${providerStatus.status}).`)
    }

    const confirmedByProvider = new Set(providerStatus.importedSupplierAddresses ?? [])
    const supplierAddresses = [...new Set((Array.isArray(suppliers) ? suppliers : []).map((s) => s?.address))]
      .filter((address): address is string => isPoktAddress(address) && confirmedByProvider.has(address))

    const pocketApiUrl = settings.pocketApiUrl
    if (!pocketApiUrl) {
      throw new Error('API URL not found')
    }

    const db = getDb()
    const existingSuppliers = supplierAddresses.length > 0 ? await getExistingNodes(supplierAddresses, userIdentity) : []
    const height = await getCurrentHeight()

    const nodesToInsert: Array<InsertNode> = []

    for (const address of supplierAddresses) {
      if (existingSuppliers.includes(address)) {
        continue
      }

      const onChain = await getChainSupplier(pocketApiUrl, address)
      if (!onChain || onChain.ownerAddress !== attempt.ownerAddress) {
        log.warn('import attempt address skipped (not owned on chain by the attempt owner)', { attemptId, address })
        continue
      }

      nodesToInsert.push({
        address,
        ownerAddress: attempt.ownerAddress,
        status: NodeStatus.Staked,
        stakeAmount: onChain.stakeAmount,
        providerId: attempt.providerIdentity,
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
        log.warn('import attempt addresses skipped (already owned by another account)', {
          attemptId,
          skippedCount: dropped.length,
        })
      }
    }
    await importAttemptsDal.markCompleted(attemptId, importedAddresses)
    log.info('import attempt completed', { attemptId, importedCount: importedAddresses.length })
  })
}

/**
 * Cancels the caller's pending import attempts for this owner+provider combination.
 */
export async function CancelPendingImportAttempts(
  ownerAddress: string,
  providerIdentity: string,
): Promise<void> {
  const userIdentity = await requireAuth()
  await importAttemptsDal.cancelPending(ownerAddress, providerIdentity, userIdentity)
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
