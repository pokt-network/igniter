'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { AbortConfirmationDialog } from '@igniter/ui/components/AbortConfirmationDialog'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'
import OwnerAddressStep from '@/app/app/stake/components/OwnerAddressStep'
import Loading from '@/app/app/stake/components/Loading'
import { SelectProviderStep } from '@/app/app/import-suppliers/components/SelectProviderStep'
import { ImportProcess } from '@/app/app/import-suppliers/components/ImportProcess'
import { ImportSuccessStep } from '@/app/app/import-suppliers/components/ImportSuccessStep'
import {
  ImportProcessStatus,
  ImportSuppliersStep,
  ProviderOption,
} from '@/app/app/import-suppliers/types'
import { ImportedSupplier } from '@/lib/services/importSuppliers'
import { CancelPendingImportAttempts } from '@/actions/ImportSuppliers'
import { getLogger } from '@igniter/logger'

const log = getLogger(['middleman', 'import-suppliers-page'])

export default function ClientImportSuppliersPage() {
  const { connectedIdentity, connectedIdentities, isConnected } =
    useWalletConnection()
  const router = useRouter()
  const { addNotification } = useNotifications()

  const [step, setStep] = useState<ImportSuppliersStep>(
    connectedIdentities && connectedIdentities.length > 1
      ? ImportSuppliersStep.OwnerAddress
      : ImportSuppliersStep.SelectProvider,
  )

  const [ownerAddress, setOwnerAddress] = useState<string>(
    connectedIdentities && connectedIdentities.length > 1
      ? ''
      : connectedIdentity || '',
  )

  const [selectedProvider, setSelectedProvider] = useState<
    ProviderOption | undefined
  >()
  const [importedSuppliers, setImportedSuppliers] = useState<
    ImportedSupplier[]
  >([])
  const [importAttemptId, setImportAttemptId] = useState<number | undefined>()
  const [isAbortDialogOpen, setAbortDialogOpen] = useState(false)
  const [isAborting, setIsAborting] = useState(false)
  const [importErrorMessage, setImportErrorMessage] = useState<
    string | undefined
  >()

  const errorsMap: Record<keyof ImportProcessStatus, string> = {
    requestImportStatus:
      'Failed to initiate import from the provider. Please try again or contact support.',
    signNonceStatus:
      'Signature failed. Your signature is required to verify ownership of the address.',
    submitImportStatus:
      'Failed to complete the import. Please try again or contact support.',
  }

  useEffect(() => {
    if (isConnected) {
      setOwnerAddress(
        connectedIdentities!.length > 1 ? '' : connectedIdentity!,
      )
      setStep(
        connectedIdentities!.length > 1
          ? ImportSuppliersStep.OwnerAddress
          : ImportSuppliersStep.SelectProvider,
      )
    }
  }, [isConnected, connectedIdentities, connectedIdentity])

  const handleOwnerAddressChange = (address: string) => {
    setOwnerAddress(address)
    setStep(ImportSuppliersStep.SelectProvider)
  }

  const handleProviderSelected = (provider: ProviderOption) => {
    setSelectedProvider(provider)
    setImportErrorMessage(undefined)
    setStep(ImportSuppliersStep.ImportProcess)
  }

  const handleImportCompleted = (
    result: ImportProcessStatus,
    suppliers?: ImportedSupplier[],
    attemptId?: number,
    errorMessage?: string,
  ) => {
    const allSucceeded = Object.values(result).every((s) => s === 'success')

    if (allSucceeded && suppliers) {
      setImportedSuppliers(suppliers)
      setImportAttemptId(attemptId)
      setStep(ImportSuppliersStep.Success)
    } else {
      // Find the failed stage and show error
      const failedStage = Object.entries(result).find(
        ([, status]) => status === 'error',
      )?.[0] as keyof ImportProcessStatus | undefined

      if (failedStage) {
        const displayError = errorMessage || errorsMap[failedStage]
        setImportErrorMessage(displayError)
      }
    }
  }

  const onAbort = useCallback(
    async (abort: boolean) => {
      if (abort) {
        setIsAborting(true)
        try {
          // Cancel any pending attempts if we have a provider selected
          if (selectedProvider && ownerAddress) {
            await CancelPendingImportAttempts(
              ownerAddress,
              selectedProvider.identity,
            )
          }
          setIsAborting(false)
          await router.push('/app')
        } catch (error) {
          log.error('failed to abort import', { error })
          addNotification({
            id: `abort-import-error`,
            type: 'error',
            showTypeIcon: true,
            content:
              'An error occurred while aborting. Please try again or contact support.',
          })
          setIsAborting(false)
        } finally {
          setAbortDialogOpen(false)
        }
      } else {
        setAbortDialogOpen(false)
      }
    },
    [selectedProvider, ownerAddress, router, addNotification],
  )

  if (!isConnected) {
    return (
      <div className="flex flex-row justify-center w-full">
        <Loading />
      </div>
    )
  }

  return (
    <>
      <OverrideSidebar>
        <div className="flex flex-row justify-center overflow-auto pb-16">
          {step === ImportSuppliersStep.OwnerAddress && (
            <OwnerAddressStep
              title={'Import Suppliers'}
              onClose={() => setAbortDialogOpen(true)}
              onOwnerAddressSelected={handleOwnerAddressChange}
              selectedOwnerAddress={ownerAddress}
            />
          )}

          {step === ImportSuppliersStep.SelectProvider && (
            <SelectProviderStep
              ownerAddress={ownerAddress}
              onProviderSelected={handleProviderSelected}
              onBack={
                connectedIdentities!.length > 1
                  ? () => setStep(ImportSuppliersStep.OwnerAddress)
                  : undefined
              }
              onClose={() => setAbortDialogOpen(true)}
            />
          )}

          {step === ImportSuppliersStep.ImportProcess && selectedProvider && (
            <ImportProcess
              provider={selectedProvider}
              ownerAddress={ownerAddress}
              onImportCompleted={handleImportCompleted}
              onBack={() => {
                setImportErrorMessage(undefined)
                setStep(ImportSuppliersStep.SelectProvider)
              }}
              onClose={() => setAbortDialogOpen(true)}
              errorMessage={importErrorMessage}
            />
          )}

          {step === ImportSuppliersStep.Success && (
            <ImportSuccessStep
              importedSuppliers={importedSuppliers}
              providerName={selectedProvider?.name || 'Provider'}
              onClose={() => router.push('/app/suppliers')}
            />
          )}
        </div>
      </OverrideSidebar>
      <AbortConfirmationDialog
        isOpen={isAbortDialogOpen}
        isLoading={isAborting}
        onResponse={onAbort}
      />
    </>
  )
}
