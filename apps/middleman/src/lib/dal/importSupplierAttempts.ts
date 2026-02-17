import 'server-only'
import { getDb } from '@/db'
import {
  ImportSupplierAttempt,
  importSupplierAttemptsTable,
  InsertImportSupplierAttempt,
} from '@igniter/db/middleman/schema'
import { ImportAttemptStatus } from '@igniter/db/middleman/enums'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Creates a new import supplier attempt record.
 *
 * @param attempt - The attempt data to insert
 * @returns The created attempt with its ID
 */
export async function create(
  attempt: InsertImportSupplierAttempt,
): Promise<ImportSupplierAttempt> {
  const [inserted] = await getDb()
    .insert(importSupplierAttemptsTable)
    .values(attempt)
    .returning()

  if (!inserted) {
    throw new Error('Failed to create import supplier attempt')
  }

  return inserted
}

/**
 * Updates an existing import attempt.
 *
 * @param id - The attempt ID to update
 * @param updates - The fields to update
 * @returns The updated attempt
 */
export async function update(
  id: number,
  updates: Partial<Omit<ImportSupplierAttempt, 'id' | 'createdAt'>>,
): Promise<ImportSupplierAttempt> {
  const [updated] = await getDb()
    .update(importSupplierAttemptsTable)
    .set(updates)
    .where(eq(importSupplierAttemptsTable.id, id))
    .returning()

  if (!updated) {
    throw new Error(`Import supplier attempt ${id} not found`)
  }

  return updated
}

/**
 * Finds a pending import attempt for the given owner and provider.
 *
 * @param ownerAddress - The owner address
 * @param providerIdentity - The provider identity
 * @returns The pending attempt or undefined
 */
export async function findPendingByOwnerAndProvider(
  ownerAddress: string,
  providerIdentity: string,
): Promise<ImportSupplierAttempt | undefined> {
  return getDb().query.importSupplierAttemptsTable.findFirst({
    where: and(
      eq(importSupplierAttemptsTable.ownerAddress, ownerAddress),
      eq(importSupplierAttemptsTable.providerIdentity, providerIdentity),
      inArray(importSupplierAttemptsTable.status, [
        ImportAttemptStatus.Initiated,
        ImportAttemptStatus.Signed,
        ImportAttemptStatus.Submitted,
      ]),
    ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  })
}

/**
 * Cancels pending import attempts for the given owner and provider.
 *
 * @param ownerAddress - The owner address
 * @param providerIdentity - The provider identity
 * @returns The number of attempts cancelled
 */
export async function cancelPending(
  ownerAddress: string,
  providerIdentity: string,
): Promise<number> {
  const result = await getDb()
    .update(importSupplierAttemptsTable)
    .set({
      status: ImportAttemptStatus.Cancelled,
    })
    .where(
      and(
        eq(importSupplierAttemptsTable.ownerAddress, ownerAddress),
        eq(importSupplierAttemptsTable.providerIdentity, providerIdentity),
        inArray(importSupplierAttemptsTable.status, [
          ImportAttemptStatus.Initiated,
          ImportAttemptStatus.Signed,
        ]),
      ),
    )
    .returning({ id: importSupplierAttemptsTable.id })

  return result.length
}

/**
 * Lists all import attempts with 'submitted' status that haven't completed.
 * Used by the recovery workflow to check if imports completed on the provider side.
 *
 * @returns Array of submitted but not completed attempts
 */
export async function listPendingSubmitted(): Promise<ImportSupplierAttempt[]> {
  return getDb().query.importSupplierAttemptsTable.findMany({
    where: eq(importSupplierAttemptsTable.status, ImportAttemptStatus.Submitted),
    orderBy: (table, { asc }) => [asc(table.submittedAt)],
  })
}

/**
 * Marks an attempt as completed with the imported supplier addresses.
 *
 * @param id - The attempt ID
 * @param importedSupplierAddresses - Array of imported supplier addresses
 */
export async function markCompleted(
  id: number,
  importedSupplierAddresses: string[],
): Promise<void> {
  await getDb()
    .update(importSupplierAttemptsTable)
    .set({
      status: ImportAttemptStatus.Completed,
      importedSupplierAddresses,
      completedAt: new Date(),
    })
    .where(eq(importSupplierAttemptsTable.id, id))
}

/**
 * Marks an attempt as failed with an error message.
 *
 * @param id - The attempt ID
 * @param errorMessage - The error message
 */
export async function markFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  await getDb()
    .update(importSupplierAttemptsTable)
    .set({
      status: ImportAttemptStatus.Failed,
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(importSupplierAttemptsTable.id, id))
}

/**
 * Gets an attempt by its ID.
 *
 * @param id - The attempt ID
 * @returns The attempt or undefined
 */
export async function getById(id: number): Promise<ImportSupplierAttempt | undefined> {
  return getDb().query.importSupplierAttemptsTable.findFirst({
    where: eq(importSupplierAttemptsTable.id, id),
  })
}
