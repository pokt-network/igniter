'use client'

import type {AddressGroupWithDetails} from '@igniter/db/provider/schema'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@igniter/ui/components/dialog'
import React, { useEffect, useState } from 'react'
import { ListAddressGroups } from '@/actions/AddressGroups'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { Dropzone, DropZoneArea, DropzoneTrigger, useDropzone } from '@igniter/ui/components/dropzone'
import { CloudUploadIcon, FileWarning } from 'lucide-react'
import ImportProcess, { ImportProcessStatus } from '@/app/admin/(internal)/keys/import/ImportProcess'
import { Button } from '@igniter/ui/components/button'
import { toCurrencyFormat } from '@igniter/ui/lib/utils'
import { LoaderIcon } from '@igniter/ui/assets'

const errorsMap: Record<keyof ImportProcessStatus, string> = {
  validateFile: 'There was an error trying to validate the file. Please try again.',
  importKeys: 'There was an error trying to import the keys. Please try again or contact support.',
};

interface ImportFormProps {
  onClose: () => void
}

export default function ImportForm({onClose}: ImportFormProps) {
  const [addressesGroup, setAddressesGroup] = useState<AddressGroupWithDetails[]>([])
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [status, setStatus] = useState<'form' | 'success'>('form')
  const [addressGroup, setAddressGroup] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [keysImported, setKeysImported] = useState(0)
  const [showInvalidFileMessage, setShowInvalidFileMessage] = useState(false)
  const [showKeysAlreadyExistsMessage, setShowKeysAlreadyExistsMessage] = useState(false)
  const [importErrorMessage, setImportErrorMessage] = useState('')

  useEffect(() => {
    ListAddressGroups().then(result => {
      if (result.success) setAddressesGroup(result.data)
      setIsDataLoading(false)
    })
  }, [])

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

  const hasError = showInvalidFileMessage || showKeysAlreadyExistsMessage

  let content: React.ReactNode;

  if (isDataLoading) {
    content = (
      <div className="flex items-center justify-center py-12">
        <LoaderIcon className="size-6 animate-spin text-text-tertiary" />
      </div>
    )
  } else if (status === 'form') {
    content = (
      <>
        {importErrorMessage && (
          <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
            <span className="text-[14px] text-text-secondary p-[11px_16px]">
              {importErrorMessage}
            </span>
          </div>
        )}

        <div className="flex flex-row items-center gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Address Group</label>
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
        </div>

        {addressGroup && (
          <div className="rounded-md border border-border-primary bg-bg-elevated">
            <div className="flex flex-row items-center gap-3 px-4 py-2.5 border-b border-border-primary">
              <span className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Name</span>
              <span className="text-sm">
                {addressesGroup.find(group => group.id.toString() === addressGroup)?.name}
              </span>
            </div>
            <div className="flex flex-row items-center gap-3 px-4 py-2.5">
              <span className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Visibility</span>
              <span className="text-sm">
                {addressesGroup.find(group => group.id.toString() === addressGroup)?.private ? 'Private' : 'Public'}
              </span>
            </div>
          </div>
        )}

        <Dropzone {...dropzone}>
          <DropZoneArea className="w-full !border-0 bg-transparent p-0">
            <DropzoneTrigger
              className={`flex flex-col items-center gap-2 w-full py-8 text-center text-sm cursor-pointer rounded-lg border border-dashed transition-colors ${
                hasError
                  ? 'border-red-500/50 bg-red-500/5'
                  : file
                    ? 'border-blue-500/50 bg-blue-500/5'
                    : 'border-border bg-bg-surface/50 hover:bg-bg-hover/50'
              }`}
            >
              <div className={`flex items-center justify-center w-10 h-10 rounded-full mb-1 ${
                hasError
                  ? 'bg-red-500/10'
                  : 'bg-blue-500/10'
              }`}>
                {hasError ? (
                  <FileWarning className="size-5 text-red-400" />
                ) : (
                  <CloudUploadIcon className="size-5 text-blue-400" />
                )}
              </div>
              {hasError ? (
                <div>
                  <p className="text-sm font-medium text-red-400">
                    {showInvalidFileMessage ? 'Invalid file format' : 'Keys already exist'}
                  </p>
                  <p className="text-xs text-text-tertiary mt-1">
                    {showInvalidFileMessage
                      ? 'Must be a JSON array of hex private keys'
                      : 'This file contains keys that are already saved'}
                  </p>
                  <p className="text-xs text-text-tertiary mt-2">Click or drag to try another file</p>
                </div>
              ) : file ? (
                <div>
                  <p className="text-sm font-medium text-blue-400">{file.name}</p>
                  <p className="text-xs text-text-tertiary mt-1">Click or drag to replace</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-text-tertiary mt-1">
                    JSON file containing an array of hex private keys
                  </p>
                </div>
              )}
            </DropzoneTrigger>
          </DropZoneArea>
        </Dropzone>

      </>
    )
  } else {
    content = (
      <>
        <div
          className={'relative flex h-[64px] mt-[-5px] gradient-border-green'}
        >
          <div className={`absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between`}>
          <span className="text-[20px] text-text-secondary">
            Keys Imported
          </span>
            <div className="flex flex-row items-center gap-2">
              <p className="font-mono !text-[20px]">
                {toCurrencyFormat(keysImported, 0, 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-primary p-[11px_16px]">
            You have successfully imported {keysImported} keys for the address group "{
            addressesGroup.find((a) => a.id === parseInt(addressGroup))?.name
          }".
          </span>
        </div>
      </>
    )
  }

  return (
    <Dialog open={true}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        hideClose
        className="gap-0 p-0 rounded-lg bg-bg-elevated sm:max-w-xl max-h-[85vh] overflow-hidden"
      >
        <DialogTitle asChild>
          <div className="py-3 px-5">
            <span className="text-sm font-semibold">
              {status === 'success' ? 'Import Complete' : 'Import Addresses'}
            </span>
          </div>
        </DialogTitle>

        <div className="h-px bg-border-primary" />

        <div className="flex flex-col gap-5 p-6 overflow-y-auto max-h-[calc(85vh-110px)]">
          {content}
        </div>

        <div className="h-px bg-border-primary" />
        <DialogFooter className="px-5 py-3 flex flex-row items-center gap-2">
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={onClose}
          >
            {status === 'success' ? 'Close' : 'Cancel'}
          </Button>
          {status === 'form' && (
            <ImportProcess
              addressGroupId={addressGroup}
              file={file!}
              onImportCompleted={onImportCompleted}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
