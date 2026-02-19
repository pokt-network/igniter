import { log } from '@temporalio/activity'
import { ImportSupplierAttempt } from '@igniter/db/middleman/schema'
import DAL from '@/lib/dal/DAL'
import { ProviderService } from '@/lib/provider'

export interface ImportStatusResponse {
  status: string
  importedSupplierAddresses?: string[]
  errorMessage?: string
}

export const importSupplierRecoveryActivities = (
  dal: DAL,
  providerService: ProviderService,
) => ({
  /**
   * Lists all import attempts with 'submitted' status that haven't completed.
   */
  async listPendingSubmittedAttempts(): Promise<ImportSupplierAttempt[]> {
    log.info('Listing pending submitted import attempts')
    return dal.importSupplierAttempts.listPendingSubmitted()
  },

  /**
   * Checks the status of an import request with the provider.
   *
   * @param providerIdentity - The identity of the provider
   * @param ownerAddress - The owner address
   * @param nonce - Optional nonce to check a specific request
   */
  async checkProviderImportStatus(
    providerIdentity: string,
    ownerAddress: string,
    nonce?: string,
  ): Promise<ImportStatusResponse> {
    log.info('Checking provider import status', {
      providerIdentity,
      ownerAddress,
      nonce: nonce?.substring(0, 8),
    })

    const provider = await dal.provider.getProviderByIdentity(providerIdentity)

    if (!provider) {
      throw new Error(`Provider not found: ${providerIdentity}`)
    }

    const payload = {
      ownerAddress,
      ...(nonce && { nonce }),
    }

    const { signature, identity } = await providerService.signPayload(
      JSON.stringify(payload),
    )

    const response = await providerService.checkImportStatus(
      provider,
      payload,
      signature,
      identity,
    )

    return response
  },

  /**
   * Saves imported suppliers to the middleman database.
   *
   * @param attemptId - The attempt ID
   * @param addresses - Array of supplier addresses to save
   * @param providerIdentity - The provider's identity string
   */
  async saveImportedSuppliers(
    attemptId: number,
    addresses: string[],
    providerIdentity: string,
  ): Promise<void> {
    log.info('Saving imported suppliers', {
      attemptId,
      addressCount: addresses.length,
      providerIdentity,
    })

    const attempt = await dal.importSupplierAttempts.getById(attemptId)

    if (!attempt) {
      throw new Error(`Import attempt not found: ${attemptId}`)
    }

    await dal.importSupplierAttempts.saveImportedSuppliers(
      attempt,
      addresses,
      providerIdentity,
    )
  },

  /**
   * Marks an import attempt as completed.
   *
   * @param attemptId - The attempt ID
   * @param importedAddresses - Array of imported supplier addresses
   */
  async markAttemptCompleted(
    attemptId: number,
    importedAddresses: string[],
  ): Promise<void> {
    log.info('Marking import attempt as completed', {
      attemptId,
      importedCount: importedAddresses.length,
    })

    await dal.importSupplierAttempts.markCompleted(attemptId, importedAddresses)
  },

  /**
   * Marks an import attempt as failed.
   *
   * @param attemptId - The attempt ID
   * @param errorMessage - The error message
   */
  async markAttemptFailed(
    attemptId: number,
    errorMessage: string,
  ): Promise<void> {
    log.info('Marking import attempt as failed', {
      attemptId,
      errorMessage,
    })

    await dal.importSupplierAttempts.markFailed(attemptId, errorMessage)
  },
})
