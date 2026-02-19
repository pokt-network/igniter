import crypto from 'crypto'
import * as schema from '@igniter/db/provider/schema'
import {
  ImportSupplierRequest,
  InsertImportSupplierRequest,
  Key,
} from '@igniter/db/provider/schema'
import { getDbClient } from '@/db'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { ImportRequestStatus, KeyState } from '@igniter/db/provider/enums'

const { importSupplierRequestsTable, keysTable } = schema

const NONCE_EXPIRY_MINUTES = 15

/**
 * Generates a cryptographically secure nonce for signature verification.
 */
function generateNonce(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Calculates the expiry timestamp for a new import request.
 */
function getExpiryTimestamp(): Date {
  const expiry = new Date()
  expiry.setMinutes(expiry.getMinutes() + NONCE_EXPIRY_MINUTES)
  return expiry
}

/**
 * Creates a new import supplier request.
 *
 * @param ownerAddress - The owner address whose suppliers are being imported
 * @param delegatorIdentity - The identity of the delegator initiating the import
 * @param matchingSupplierAddresses - Array of supplier addresses that match the owner
 * @returns The created import request with nonce and expiry
 */
export async function createImportRequest(
  ownerAddress: string,
  delegatorIdentity: string,
  matchingSupplierAddresses: string[],
): Promise<ImportSupplierRequest> {
  const dbClient = getDbClient()

  const request: InsertImportSupplierRequest = {
    ownerAddress,
    delegatorIdentity,
    nonce: generateNonce(),
    status: ImportRequestStatus.Pending,
    matchingSupplierAddresses,
    expiresAt: getExpiryTimestamp(),
  }

  const [inserted] = await dbClient.db
    .insert(importSupplierRequestsTable)
    .values(request)
    .returning()

  if (!inserted) {
    throw new Error('Failed to insert import request')
  }

  return inserted
}

/**
 * Finds a pending import request for the given owner and delegator.
 *
 * @param ownerAddress - The owner address
 * @param delegatorIdentity - The delegator identity
 * @returns The pending request or undefined
 */
export async function findPendingRequest(
  ownerAddress: string,
  delegatorIdentity: string,
): Promise<ImportSupplierRequest | undefined> {
  const dbClient = getDbClient()

  return dbClient.db.query.importSupplierRequestsTable.findFirst({
    where: and(
      eq(importSupplierRequestsTable.ownerAddress, ownerAddress),
      eq(importSupplierRequestsTable.delegatorIdentity, delegatorIdentity),
      eq(importSupplierRequestsTable.status, ImportRequestStatus.Pending),
    ),
  })
}

/**
 * Finds the latest import request for the given owner and delegator.
 * Used for status checks in recovery scenarios.
 *
 * @param ownerAddress - The owner address
 * @param delegatorIdentity - The delegator identity
 * @param nonce - Optional nonce to find a specific request
 * @returns The latest request or undefined
 */
export async function findLatestRequest(
  ownerAddress: string,
  delegatorIdentity: string,
  nonce?: string,
): Promise<ImportSupplierRequest | undefined> {
  const dbClient = getDbClient()

  const filters = [
    eq(importSupplierRequestsTable.ownerAddress, ownerAddress),
    eq(importSupplierRequestsTable.delegatorIdentity, delegatorIdentity),
  ]

  if (nonce) {
    filters.push(eq(importSupplierRequestsTable.nonce, nonce))
  }

  return dbClient.db.query.importSupplierRequestsTable.findFirst({
    where: and(...filters),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  })
}

/**
 * Finds staked suppliers by owner address.
 * Returns suppliers where deliveredTo is NULL and state is 'staked'.
 *
 * @param ownerAddress - The owner address to search for
 * @returns Array of matching keys (suppliers)
 */
export async function findSuppliersByOwner(
  ownerAddress: string,
  excludeAddresses: string[] = [],
): Promise<Key[]> {
  const dbClient = getDbClient()

  const conditions = [
    eq(keysTable.ownerAddress, ownerAddress),
    inArray(keysTable.state, [KeyState.Staked, KeyState.AttentionNeeded, KeyState.RemediationFailed]),
  ]

  if (excludeAddresses.length > 0) {
    conditions.push(notInArray(keysTable.address, excludeAddresses))
  }

  return dbClient.db.query.keysTable.findMany({
    where: and(...conditions),
  })
}

/**
 * Cancels all pending import requests for the given owner and delegator.
 * Used when a user aborts and retries.
 *
 * @param ownerAddress - The owner address
 * @param delegatorIdentity - The delegator identity
 * @returns The number of requests cancelled
 */
export async function cancelPendingRequests(
  ownerAddress: string,
  delegatorIdentity: string,
): Promise<number> {
  const dbClient = getDbClient()

  const result = await dbClient.db
    .update(importSupplierRequestsTable)
    .set({
      status: ImportRequestStatus.Cancelled,
    })
    .where(
      and(
        eq(importSupplierRequestsTable.ownerAddress, ownerAddress),
        eq(importSupplierRequestsTable.delegatorIdentity, delegatorIdentity),
        eq(importSupplierRequestsTable.status, ImportRequestStatus.Pending),
      ),
    )
    .returning({ id: importSupplierRequestsTable.id })

  return result.length
}

/**
 * Marks an import request as completed.
 *
 * @param requestId - The request ID to mark as completed
 */
export async function markRequestCompleted(requestId: number): Promise<void> {
  const dbClient = getDbClient()

  await dbClient.db
    .update(importSupplierRequestsTable)
    .set({
      status: ImportRequestStatus.Completed,
      completedAt: new Date(),
    })
    .where(eq(importSupplierRequestsTable.id, requestId))
}

/**
 * Marks an import request as failed with an error message.
 *
 * @param requestId - The request ID to mark as failed
 * @param errorMessage - The error message describing the failure
 */
export async function markRequestFailed(
  requestId: number,
  errorMessage: string,
): Promise<void> {
  const dbClient = getDbClient()

  await dbClient.db
    .update(importSupplierRequestsTable)
    .set({
      status: ImportRequestStatus.Failed,
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(importSupplierRequestsTable.id, requestId))
}

/**
 * Marks an import request as expired.
 *
 * @param requestId - The request ID to mark as expired
 */
export async function markRequestExpired(requestId: number): Promise<void> {
  const dbClient = getDbClient()

  await dbClient.db
    .update(importSupplierRequestsTable)
    .set({
      status: ImportRequestStatus.Expired,
      completedAt: new Date(),
    })
    .where(eq(importSupplierRequestsTable.id, requestId))
}

/**
 * Assigns suppliers to a delegator by updating the keys table.
 * Sets deliveredTo, delegatorRevSharePercentage, and delegatorRewardsAddress.
 *
 * @param addresses - Array of supplier addresses to assign
 * @param delegatorIdentity - The delegator identity to assign to
 * @param revSharePercentage - The revenue share percentage for the delegator
 * @param rewardsAddress - The address where delegator rewards will be sent
 * @returns Array of updated keys
 */
export async function assignSuppliersToDelegate(
  addresses: string[],
  delegatorIdentity: string,
  revSharePercentage: number,
  rewardsAddress: string,
): Promise<Key[]> {
  if (addresses.length === 0) return []

  const dbClient = getDbClient()

  return dbClient.db
    .update(keysTable)
    .set({
      deliveredTo: delegatorIdentity,
      deliveredAt: new Date(),
      delegatorRevSharePercentage: revSharePercentage,
      delegatorRewardsAddress: rewardsAddress,
      state: KeyState.Staked,
    })
    .where(
      and(
        inArray(keysTable.address, addresses),
        inArray(keysTable.state, [KeyState.Staked, KeyState.AttentionNeeded, KeyState.RemediationFailed]),
      ),
    )
    .returning()
}

/**
 * Gets a request by its nonce.
 *
 * @param nonce - The nonce to search for
 * @returns The request or undefined
 */
export async function findRequestByNonce(
  nonce: string,
): Promise<ImportSupplierRequest | undefined> {
  const dbClient = getDbClient()

  return dbClient.db.query.importSupplierRequestsTable.findFirst({
    where: eq(importSupplierRequestsTable.nonce, nonce),
  })
}

/**
 * Checks if a request has expired based on its expiresAt timestamp.
 *
 * @param request - The import request to check
 * @returns true if the request has expired
 */
export function isRequestExpired(request: ImportSupplierRequest): boolean {
  return new Date() > request.expiresAt
}
