import { proxyActivities, log } from '@temporalio/workflow'
import type { importSupplierRecoveryActivities } from '@/activities/importSupplierRecovery'

/**
 * ImportSupplierRecovery workflow runs periodically to recover from failed imports.
 *
 * This workflow handles cases where:
 * - The submit request was sent to the provider but the response was lost
 * - Network issues occurred after the provider completed the import
 * - The middleman process crashed before saving the imported suppliers
 *
 * It checks with the provider for the status of submitted attempts and
 * completes the import on the middleman side if needed.
 */
export async function ImportSupplierRecovery() {
  const {
    listPendingSubmittedAttempts,
    checkProviderImportStatus,
    saveImportedSuppliers,
    markAttemptCompleted,
    markAttemptFailed,
  } = proxyActivities<ReturnType<typeof importSupplierRecoveryActivities>>({
    startToCloseTimeout: '30s',
    retry: {
      maximumAttempts: 3,
    },
  })

  log.info('Starting ImportSupplierRecovery workflow')

  // Get attempts that were submitted but not completed
  const pendingAttempts = await listPendingSubmittedAttempts()

  if (pendingAttempts.length === 0) {
    log.info('No pending submitted attempts to recover')
    return { recovered: 0, failed: 0 }
  }

  log.info(`Found ${pendingAttempts.length} pending submitted attempt(s) to check`)

  let recovered = 0
  let failed = 0

  for (const attempt of pendingAttempts) {
    try {
      log.info(`Checking import status for attempt ${attempt.id}`, {
        attemptId: attempt.id,
        providerIdentity: attempt.providerIdentity,
        ownerAddress: attempt.ownerAddress,
      })

      // Check with provider if import was completed
      const status = await checkProviderImportStatus(
        attempt.providerIdentity,
        attempt.ownerAddress,
        attempt.nonce || undefined,
      )

      if (status.status === 'completed' && status.importedSupplierAddresses) {
        log.info(`Provider confirmed import completed for attempt ${attempt.id}`, {
          importedCount: status.importedSupplierAddresses.length,
        })

        // Provider completed, save to middleman DB
        await saveImportedSuppliers(
          attempt.id,
          status.importedSupplierAddresses,
          attempt.providerIdentity,
        )

        await markAttemptCompleted(attempt.id, status.importedSupplierAddresses)

        log.info(`Successfully recovered import for attempt ${attempt.id}`)
        recovered++
      } else if (status.status === 'expired' || status.status === 'failed') {
        log.warn(`Import attempt ${attempt.id} has status: ${status.status}`, {
          errorMessage: status.errorMessage,
        })

        await markAttemptFailed(
          attempt.id,
          status.errorMessage || `Import ${status.status} on provider`,
        )
        failed++
      } else if (status.status === 'pending') {
        // Still pending on provider side, leave it for next run
        log.info(`Import attempt ${attempt.id} is still pending on provider`)
      } else {
        log.warn(`Unknown status for attempt ${attempt.id}: ${status.status}`)
      }
    } catch (error) {
      const { message } = error as Error
      log.error(`Error checking import status for attempt ${attempt.id}`, {
        error: message,
      })
      // Don't mark as failed - it might be a transient error, will retry next run
    }
  }

  log.info('ImportSupplierRecovery workflow completed', { recovered, failed })

  return { recovered, failed }
}
