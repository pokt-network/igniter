'use client'

import type {AddressGroupWithDetails} from '@igniter/db/provider/schema'
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader'
import { useRouter } from 'next/navigation'
import { AbortConfirmationDialog } from '@igniter/ui/components/AbortConfirmationDialog'
import React, { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { Dropzone, DropZoneArea, DropzoneTrigger, useDropzone } from '@igniter/ui/components/dropzone'
import { CloudUploadIcon, FileWarning } from 'lucide-react'
import ImportProcess, { ImportProcessStatus } from '@/app/admin/(internal)/keys/import/ImportProcess'
import { Button } from '@igniter/ui/components/button'
import { toCurrencyFormat } from '@igniter/ui/lib/utils'
import { LoaderIcon } from '@igniter/ui/assets'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'

const errorsMap: Record<keyof ImportProcessStatus, string> = {
  validateFile: 'There was an error trying to validate the file. Please try again.',
  importKeys: 'There was an error trying to import the keys. Please try again or contact support.',
};

interface ImportFormProps {
  addressesGroup: AddressGroupWithDetails[]
}

export default function ImportForm({addressesGroup}: ImportFormProps) {
  const router = useRouter()
  const [isRedirecting, setIsRedirecting] = useState<boolean>(false);
  const [isAbortDialogOpen, setAbortDialogOpen] = useState(false)
  const [status, setStatus] = useState<'form' | 'success'>('form')
  const [addressGroup, setAddressGroup] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [keysImported, setKeysImported] = useState(0)
  const [showInvalidFileMessage, setShowInvalidFileMessage] = useState(false)
  const [showKeysAlreadyExistsMessage, setShowKeysAlreadyExistsMessage] = useState(false)
  const [importErrorMessage, setImportErrorMessage] = useState('')

  const dropzone = useDropzone({
    validation: {
      accept: {
        'application/json': ['*'],
      },
      maxFiles: 1,
    },
    shiftOnMaxFiles: true,
    onDropFile: async (file: File) => {
      setFile(file)
      setShowInvalidFileMessage(false)
      setShowKeysAlreadyExistsMessage(false)
      return {
        status: 'success',
        result: file,
      }
    }
  })

  const onImportCompleted = (importStatus: ImportProcessStatus, keysImported?: number) => {
    if (importStatus.importKeys === 'success') {
      setStatus('success')
      setKeysImported(keysImported!)
    } else if (importStatus.validateFile === 'invalid') {
      setFile(null)
      setShowInvalidFileMessage(true)
    } else if (importStatus.importKeys === 'invalid') {
      setFile(null)
      setShowKeysAlreadyExistsMessage(true)
    } else if (importStatus.validateFile === 'error') {
      setImportErrorMessage(errorsMap.validateFile)
    } else if (importStatus.importKeys === 'error') {
      setImportErrorMessage(errorsMap.importKeys)
    }
  }

  let content: React.ReactNode;

  if (status === 'form') {
    content = (
      <>
        {importErrorMessage && (
          <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
            <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
              {importErrorMessage}
            </span>
          </div>
        )}

        <Select value={addressGroup} onValueChange={setAddressGroup}>
          <SelectTrigger className={'w-full'}>
            <SelectValue placeholder={'Select an address group'} />
          </SelectTrigger>
          <SelectContent>
            {addressesGroup.map((addressGroup) => (
              <SelectItem value={addressGroup.id.toString()} key={addressGroup.id.toString()}>
                {addressGroup.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {addressGroup && (
          <div className="p-4 rounded-md bg-[var(--color-slate-2)]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[var(--color-white-3)]">Name</span>
                <span className="text-sm">
          {addressesGroup.find(group => group.id.toString() === addressGroup)?.name}
        </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-[var(--color-white-3)]">Visibility</span>
                <span className="text-sm">
          {addressesGroup.find(group => group.id.toString() === addressGroup)?.private ? 'Private' : 'Public'}
        </span>
              </div>
            </div>
          </div>
        )}

        <Dropzone {...dropzone}>
          <DropZoneArea>
            <DropzoneTrigger
              className={'flex flex-col items-center gap-4 bg-transparent p-10 text-center text-sm'}
            >
              <CloudUploadIcon className="size-8" />
              <div>
                <p className="font-semibold">
                  {file ? (<span>
                    Uploaded file: <span className={'bg-[var(--color-slate-2)] px-2 py-0.5 rounded-[8px]'}>
                      {file.name}
                    </span>
                  </span>) : 'Upload your keys json file'}
                </p>
                <p className="!text-xs text-muted-foreground mt-2">
                  This file must be a json containing an array of hex private keys.
                </p>
              </div>
            </DropzoneTrigger>
          </DropZoneArea>
        </Dropzone>
        {(showInvalidFileMessage || showKeysAlreadyExistsMessage) && (
          <div className={'flex flex-row items-center gap-2 mt-[-24px]'}>
            <FileWarning className={'text-[color:var(--warning)]'} />
            <p className={'!text-xs'}>
              {showInvalidFileMessage ?
                'The file you uploaded is not valid. It must be a json containing an array of hex private keys.' :
                'The file you uploaded contains keys that are already saved. Please select a different file.'
              }
            </p>
          </div>
        )}

        <ImportProcess
          addressGroupId={addressGroup}
          file={file!}
          onImportCompleted={onImportCompleted}
        />
      </>
    )
  } else {
    content = (
      <>
        <div
          className={'relative flex h-[64px] mt-[-5px] gradient-border-green'}
        >
          <div className={`absolute inset-0 flex flex-row items-center bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
          <span className="text-[20px] text-[var(--color-white-3)]">
            Keys Imported
          </span>
            <div className="flex flex-row items-center gap-2">
              <p className="font-mono !text-[20px]">
                {toCurrencyFormat(keysImported, 0, 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
          <span className="text-[14px] text-[var(--color-white-1)] p-[11px_16px]">
            You have successfully imported {keysImported} keys for the address group "{
            addressesGroup.find((a) => a.id === parseInt(addressGroup))?.name
          }".
          </span>
        </div>

        <Button
          className="w-full h-[40px]"
          onClick={() => {
            setIsRedirecting(true)
            router.push('/admin/keys')
          }}
        >
          {isRedirecting && (
            <LoaderIcon className="animate-spin"/>
          )}
          {!isRedirecting && 'Close'}
        </Button>
      </>
    )
  }

  return (
    <>
      <OverrideSidebar>
        <div className="flex flex-row justify-center w-full">
          <div
            className="flex flex-col w-[480px] border-x border-b border-[--balck-deviders] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8"
          >
            <ActivityHeader
              title="Import Addresses"
              subtitle={status === 'success' ? '' : 'Select the address group and import your keys json file.'}
              onClose={() => setAbortDialogOpen(true)}
              isDisabled={status === 'success'}
            />

            {content}
          </div>
        </div>
      </OverrideSidebar>
      <AbortConfirmationDialog
        type={'import'}
        isOpen={isAbortDialogOpen}
        onResponse={(abort) => {
          setAbortDialogOpen(false);
          if (abort) {
            router.push('/admin/keys')
          }
        }}
      />
    </>
  )
}
