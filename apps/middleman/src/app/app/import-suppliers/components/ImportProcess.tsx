'use client'

import { useEffect, useState } from 'react'
import { Button } from '@igniter/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@igniter/ui/components/dialog'
import { CheckSuccess, LoaderIcon, XIcon } from '@igniter/ui/assets'
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { useApplicationSettings } from '@/app/context/ApplicationSettings'
import {
  requestImportSuppliers,
  submitImportSuppliers,
  ImportedSupplier,
} from '@/lib/services/importSuppliers'
import {
  CreateImportAttempt,
  UpdateImportAttemptStatus,
  CompleteImportAttempt,
  CancelPendingImportAttempts,
  GetExistingNodeAddressesByOwnerAndProvider,
} from '@/actions/ImportSuppliers'
import { ImportAttemptStatus } from '@igniter/db/middleman/enums'
import {
  ImportProcessStatus,
  ImportStageStatus,
  ProviderOption,
} from '@/app/app/import-suppliers/types'
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { getShortAddress } from '@igniter/ui/lib/utils'
import { fromBase64, toHex } from '@cosmjs/encoding'

interface ImportProcessProps {
  provider: ProviderOption
  ownerAddress: string
  onImportCompleted: (
    result: ImportProcessStatus,
    suppliers?: ImportedSupplier[],
    attemptId?: number,
    errorMessage?: string,
  ) => void
  onBack: () => void
  onClose: () => void
  errorMessage?: string
}

enum ImportProcessStep {
  RequestImport,
  SignNonce,
  SubmitImport,
  Completed,
}

function stageSucceeded(stage: ImportStageStatus) {
  return stage === 'success'
}

function stageFailed(stage: ImportStageStatus) {
  return stage === 'error'
}

export function ImportProcess({
  provider,
  ownerAddress,
  onImportCompleted,
  onBack,
  onClose,
  errorMessage,
}: ImportProcessProps) {
  const [open, setOpen] = useState(false)
  const [isCancellable, setIsCancellable] = useState(true)
  const [importStatus, setImportStatus] = useState<ImportProcessStatus>({
    requestImportStatus: 'pending',
    signNonceStatus: 'pending',
    submitImportStatus: 'pending',
  })
  const [currentStep, setCurrentStep] = useState<ImportProcessStep>(
    ImportProcessStep.RequestImport,
  )
  const { signMessage, getPublicKey } = useWalletConnection()
  const settings = useApplicationSettings()

  // Data collected during the process
  const [nonce, setNonce] = useState<string | null>(null)
  const [matchingSuppliers, setMatchingSuppliers] = useState<number>(0)
  const [signedNonce, setSignedNonce] = useState<string | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [attemptId, setAttemptId] = useState<number | null>(null)
  const [importedSuppliers, setImportedSuppliers] = useState<ImportedSupplier[]>([])
  const [processError, setProcessError] = useState<string | null>(null)

  // Step 1: Request import from provider
  useEffect(() => {
    ;(async () => {
      if (!open || currentStep !== ImportProcessStep.RequestImport) {
        return
      }

      try {
        // Cancel any previous pending attempts
        await CancelPendingImportAttempts(ownerAddress, provider.identity)

        // Fetch suppliers already imported for this owner+provider to exclude them
        const existingAddresses = await GetExistingNodeAddressesByOwnerAndProvider(
          ownerAddress,
          provider.identity,
        )

        // Request import from provider
        const response = await requestImportSuppliers(
          provider.identity,
          ownerAddress,
          existingAddresses,
        )

        setNonce(response.nonce)
        setMatchingSuppliers(response.matchingSuppliers)

        // Create audit record
        const newAttemptId = await CreateImportAttempt(
          ownerAddress,
          provider.identity,
          provider.id,
          response.nonce,
        )
        setAttemptId(newAttemptId)

        setImportStatus((prev) => ({
          ...prev,
          requestImportStatus: 'success',
        }))

        setCurrentStep(ImportProcessStep.SignNonce)
      } catch (err) {
        const { message } = err as Error
        console.error('Failed to request import:', message)

        // Set user-friendly error message
        let userFriendlyError: string
        if (message === 'No unassigned staked suppliers found for this owner address.') {
          userFriendlyError = `You do not have any suppliers to import with ${provider.name}.`
        } else {
          userFriendlyError = message
        }

        setProcessError(userFriendlyError)
        handleFailedStage('requestImportStatus', userFriendlyError)
      }
    })()
  }, [open, currentStep])

  // Step 2: Sign the nonce with wallet
  useEffect(() => {
    ;(async () => {
      if (!open || currentStep !== ImportProcessStep.SignNonce || !nonce) {
        return
      }

      try {
        // Get the public key and sign the nonce
        const pubKey = await getPublicKey(ownerAddress)
        const signature = await signMessage(nonce, ownerAddress)

        // Convert public key to hex if needed (Keplr returns base64, provider expects 66-char hex)
        const isHex = /^[0-9a-fA-F]+$/.test(pubKey)
        const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(pubKey)
        let hexPubKey: string
        if (isHex) {
          hexPubKey = pubKey
        } else if (isBase64) {
          hexPubKey = toHex(fromBase64(pubKey))
        } else {
          throw new Error('Public key is not in a recognized format (expected hex or base64)')
        }
        setPublicKey(hexPubKey)
        setSignedNonce(signature)

        // Update attempt status
        if (attemptId) {
          await UpdateImportAttemptStatus(attemptId, ImportAttemptStatus.Signed, {
            signedAt: new Date(),
          })
        }

        setImportStatus((prev) => ({
          ...prev,
          signNonceStatus: 'success',
        }))

        setIsCancellable(false)
        setCurrentStep(ImportProcessStep.SubmitImport)
      } catch (err) {
        const { message } = err as Error
        console.error('Failed to sign nonce:', message)

        const userFriendlyError = message
        setProcessError(userFriendlyError)
        handleFailedStage('signNonceStatus', userFriendlyError)
      }
    })()
  }, [open, currentStep, nonce])

  // Step 3: Submit signed nonce to provider
  useEffect(() => {
    ;(async () => {
      if (
        !open ||
        currentStep !== ImportProcessStep.SubmitImport ||
        !signedNonce ||
        !publicKey
      ) {
        return
      }

      try {
        // Update attempt status to submitted
        if (attemptId) {
          await UpdateImportAttemptStatus(
            attemptId,
            ImportAttemptStatus.Submitted,
            {
              submittedAt: new Date(),
            },
          )
        }

        // Submit to provider
        const response = await submitImportSuppliers(
          provider.identity,
          ownerAddress,
          publicKey,
          signedNonce,
          settings!.delegatorRewardsAddress!,
          Number(settings!.fee || 0),
        )

        setImportedSuppliers(response.importedSuppliers)

        // Complete the attempt - save suppliers to DB
        if (attemptId) {
          await CompleteImportAttempt(
            attemptId,
            response.importedSuppliers,
            provider.identity,
          )
        }

        setImportStatus((prev) => ({
          ...prev,
          submitImportStatus: 'success',
        }))

        setCurrentStep(ImportProcessStep.Completed)
      } catch (err) {
        const { message } = err as Error
        console.error('Failed to submit import:', message)

        const userFriendlyError = message
        setProcessError(userFriendlyError)
        handleFailedStage('submitImportStatus', userFriendlyError)
      }
    })()
  }, [open, currentStep, signedNonce, publicKey])

  // Step 4: Completed - notify parent
  useEffect(() => {
    if (open && currentStep === ImportProcessStep.Completed) {
      setTimeout(() => {
        onImportCompleted(
          importStatus,
          importedSuppliers,
          attemptId ?? undefined,
          undefined,
        )
        setOpen(false)
      }, 1000)
    }
  }, [open, currentStep])

  function handleOpenChanged(isOpen: boolean) {
    setOpen(isOpen)

    if (!isOpen) {
      setProcessError(null)
      // Reset state for next attempt
      let newStep: ImportProcessStep

      if (importStatus.requestImportStatus !== 'success') {
        newStep = ImportProcessStep.RequestImport
      } else if (importStatus.signNonceStatus !== 'success') {
        newStep = ImportProcessStep.SignNonce
      } else if (importStatus.submitImportStatus !== 'success') {
        newStep = ImportProcessStep.SubmitImport
      } else {
        newStep = ImportProcessStep.Completed
      }

      setCurrentStep(newStep)

      let newImportStatus: ImportProcessStatus

      if (newStep === ImportProcessStep.RequestImport) {
        newImportStatus = {
          requestImportStatus: 'pending',
          signNonceStatus: 'pending',
          submitImportStatus: 'pending',
        }
      } else if (newStep === ImportProcessStep.SignNonce) {
        newImportStatus = {
          requestImportStatus: 'success',
          signNonceStatus: 'pending',
          submitImportStatus: 'pending',
        }
      } else if (newStep === ImportProcessStep.SubmitImport) {
        newImportStatus = {
          requestImportStatus: 'success',
          signNonceStatus: 'success',
          submitImportStatus: 'pending',
        }
      } else {
        return
      }

      setImportStatus(newImportStatus)
      setIsCancellable(true)
    } else {
      if (currentStep === ImportProcessStep.Completed) {
        return
      }
      // Reset status for current step when reopening
      if (currentStep === ImportProcessStep.RequestImport) {
        setImportStatus({
          requestImportStatus: 'pending',
          signNonceStatus: 'pending',
          submitImportStatus: 'pending',
        })
      } else if (currentStep === ImportProcessStep.SignNonce) {
        setImportStatus({
          requestImportStatus: 'success',
          signNonceStatus: 'pending',
          submitImportStatus: 'pending',
        })
      } else if (currentStep === ImportProcessStep.SubmitImport) {
        setImportStatus({
          requestImportStatus: 'success',
          signNonceStatus: 'success',
          submitImportStatus: 'pending',
        })
      }

      setIsCancellable(true)
    }
  }

  function handleFailedStage(stageName: keyof ImportProcessStatus, message?: string) {
    setImportStatus((prev) => ({
      ...prev,
      [stageName]: 'error',
    }))

    setTimeout(() => {
      setImportStatus((currentStatus) => {
        onImportCompleted(currentStatus, undefined, undefined, message)
        handleOpenChanged(false)
        return currentStatus
      })
    }, 1000)
  }

  return (
    <div className="flex relative flex-col w-[580px] border-x border-b border-border-primary bg-bg-root p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Import Suppliers"
        subtitle={`Import staked suppliers from ${provider.name}`}
        onClose={onClose}
        onBack={onBack}
      />

      <div className="flex flex-col gap-4">
        <div className="bg-[var(--input-bg)] p-4 rounded-lg">
          <h3 className="text-sm font-medium mb-2">Selected Provider</h3>
          <p className="text-lg">{provider.name}</p>
          <p className="text-xs text-text-tertiary font-mono mt-1 truncate">
            {provider.identity}
          </p>
        </div>

        <div className="bg-[var(--input-bg)] p-4 rounded-lg">
          <h3 className="text-sm font-medium mb-2">Owner Address</h3>
          <div className={'flex items-center gap-2 -mt-1'}>
            <AvatarByString string={ownerAddress} size={16} />
            <p className="text-xs font-mono truncate mt-[3px]">{getShortAddress(ownerAddress)}</p>
          </div>
        </div>

        {(errorMessage || processError) && (
          <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg">
            <p className="text-sm text-error">{processError || errorMessage}</p>
          </div>
        )}

        <div className="text-xs text-text-tertiary mt-2">
          <p>Click "Import" to start the import process:</p>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>Request a verification challenge from the provider</li>
            <li>Sign the challenge with your wallet to prove ownership</li>
            <li>Complete the import and receive your suppliers</li>
          </ol>
        </div>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChanged}>
        <DialogTrigger asChild>
          <Button className="w-full h-[40px]">Import</Button>
        </DialogTrigger>
        <DialogContent
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="gap-0 w-[280px] p-0 rounded-lg bg-[var(--bg-surface)]"
          hideClose
        >
          <DialogTitle asChild>
            <div className="flex flex-row justify-between items-center py-3 px-4">
              <span className="text-[14px]">Importing</span>
              <LoaderIcon className="animate-spin" />
            </div>
          </DialogTitle>
          <div className="h-[1px] bg-[var(--border-subtle)]" />

          <div className="flex flex-row justify-between items-center py-3 px-4">
            <span className="text-[14px]">Requesting Import</span>
            {stageSucceeded(importStatus.requestImportStatus) && <CheckSuccess />}
            {stageFailed(importStatus.requestImportStatus) && (
              <XIcon className="fill-current text-error" />
            )}
          </div>
          <div className="h-[1px] bg-[var(--border-subtle)]" />

          <div className="flex flex-row justify-between items-center py-3 px-4">
            <span className="text-[14px]">Signing Verification</span>
            {stageSucceeded(importStatus.signNonceStatus) && <CheckSuccess />}
            {stageFailed(importStatus.signNonceStatus) && (
              <XIcon className="fill-current text-error" />
            )}
          </div>
          <div className="h-[1px] bg-[var(--border-subtle)]" />

          <div className="flex flex-row justify-between items-center py-3 px-4">
            <span className="text-[14px]">Completing Import</span>
            {stageSucceeded(importStatus.submitImportStatus) && <CheckSuccess />}
            {stageFailed(importStatus.submitImportStatus) && (
              <XIcon className="fill-current text-error" />
            )}
          </div>
          <div className="h-[1px] bg-[var(--border-subtle)]" />

          <DialogFooter className="p-2">
            <DialogClose className="w-full" asChild>
              <Button disabled={!isCancellable} variant="secondaryBorder" type="submit">
                Cancel
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
