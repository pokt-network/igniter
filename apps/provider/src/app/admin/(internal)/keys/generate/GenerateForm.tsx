'use client'
import type { AddressGroupWithDetails } from '@igniter/db/provider/schema'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@igniter/ui/components/select'
import { LoaderIcon } from '@igniter/ui/assets'
import { Button } from '@igniter/ui/components/button'
import { toCurrencyFormat } from '@igniter/ui/lib/utils'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader'
import { AbortConfirmationDialog } from '@igniter/ui/components/AbortConfirmationDialog'
import { GenerateKeys } from '@/actions/Keys'
import {exportToJson} from '@/app/admin/(internal)/keys/exportUtils'


interface GenerateFormProps {
  addressesGroup: AddressGroupWithDetails[]
}

export default function GenerateForm({ addressesGroup }: GenerateFormProps) {
  const router = useRouter()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [isAbortDialogOpen, setAbortDialogOpen] = useState(false)
  const [status, setStatus] = useState<'form' | 'loading' | 'success' | 'error'>('form')
  const [addressGroup, setAddressGroup] = useState<string>('')
  const [keyCount, setKeyCount] = useState<string>('')
  const [keysGenerated, setKeysGenerated] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  const parsedCount = parseInt(keyCount, 10)
  const isValidCount = !isNaN(parsedCount) && parsedCount >= 1 && parsedCount <= 10000

  const handleGenerate = async () => {
    if (!addressGroup || !isValidCount || status === 'loading') return

    setStatus('loading')
    setErrorMessage('')
    try {
      const result = await GenerateKeys(Number(addressGroup), parsedCount)

      if (!result || !result.success) {
        throw new Error('Failed to generate keys')
      }

      const privateKeys = result.data
      const groupName = addressesGroup.find(a => a.id === Number(addressGroup))?.name ?? 'keys'
      const filename = `${groupName}-generated-${parsedCount}-keys-at-${new Date().toISOString().replace(/[:.]/g, '_')}.json`

      exportToJson(privateKeys, filename)
      setKeysGenerated(privateKeys.length)
      setStatus('success')
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'An unexpected error occurred')
      setStatus('error')
    }
  }

  let content: React.ReactNode

  if (status === 'form' || status === 'loading') {
    content = (
      <>
        <Select value={addressGroup} onValueChange={setAddressGroup}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an address group" />
          </SelectTrigger>
          <SelectContent>
            {addressesGroup.map(group => (
              <SelectItem value={group.id.toString()} key={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-secondary">Number of Keys</label>
          <input
            type="number"
            min={1}
            max={10000}
            value={keyCount}
            onChange={(e) => setKeyCount(e.target.value)}
            placeholder="Enter amount (1 - 10,000)"
            className="w-full h-9 rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[color:--color-blue-1]"
          />
        </div>

        {addressGroup && isValidCount && (
          <div className="p-4 rounded-md bg-bg-elevated">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-secondary">Address Group</span>
                <span className="text-sm">
                  {addressesGroup.find(g => g.id.toString() === addressGroup)?.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-secondary">Keys to Generate</span>
                <span className="text-sm">{toCurrencyFormat(parsedCount, 0, 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-secondary">Initial State</span>
                <span className="text-sm">Available</span>
              </div>
            </div>
          </div>
        )}

        <p>
          Example output:
          <br />
          <div className="p-4 rounded-md bg-bg-elevated mt-2">
            <pre className="whitespace-pre-wrap">{JSON.stringify([{ hex: '<pk1>' }, { hex: '<pk2>' }], null, 2)}</pre>
          </div>
        </p>

        <Button
          className="w-full h-[40px]"
          onClick={handleGenerate}
          disabled={status === 'loading' || !addressGroup || !isValidCount}
        >
          {status === 'loading' && <LoaderIcon className="animate-spin" />}
          {status === 'form' && 'Generate & Download Keys'}
        </Button>
      </>
    )
  } else if (status === 'success') {
    content = (
      <>
        <div className="relative flex h-[64px] mt-[-5px] gradient-border-green">
          <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
            <span className="text-[20px] text-text-secondary">Keys Generated</span>
            <div className="flex flex-row items-center gap-2">
              <p className="font-mono !text-[20px]">{toCurrencyFormat(keysGenerated, 0, 0)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-primary p-[11px_16px]">
            You have successfully generated {keysGenerated} keys in the address group &quot;{
              addressesGroup.find(a => a.id === Number(addressGroup))?.name
            }&quot;. The keys file has been downloaded.
          </span>
        </div>

        <Button
          className="w-full h-[40px]"
          onClick={() => {
            setIsRedirecting(true)
            router.push('/admin/keys')
          }}
        >
          {isRedirecting && <LoaderIcon className="animate-spin" />}
          {!isRedirecting && 'Close'}
        </Button>
      </>
    )
  } else if (status === 'error') {
    content = (
      <>
        <div className="relative flex h-[64px] mt-[-5px] gradient-border-red">
          <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
            <span className="text-[20px] text-text-secondary">Oops! Something went wrong.</span>
          </div>
        </div>

        {errorMessage && (
          <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
            <span className="text-[14px] text-text-primary p-[11px_16px]">{errorMessage}</span>
          </div>
        )}

        <Button
          className="w-full h-[40px]"
          onClick={handleGenerate}
        >
          Try Again
        </Button>
      </>
    )
  }

  return (
    <>
      <OverrideSidebar>
        <div className="flex flex-row justify-center w-full">
          <div className="flex flex-col w-[480px] border-x border-b border-[--balck-deviders] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
            <ActivityHeader
              title="Generate Keys"
              subtitle={status === 'success' ? '' : 'Generate new keys and download them as a JSON file.'}
              onClose={() => setAbortDialogOpen(true)}
              isDisabled={status === 'success'}
            />
            {content}
          </div>
        </div>
      </OverrideSidebar>
      <AbortConfirmationDialog
        type="generate"
        isOpen={isAbortDialogOpen}
        onResponse={(abort) => {
          setAbortDialogOpen(false)
          if (abort) {
            setIsRedirecting(true)
            router.push('/admin/keys')
          }
        }}
      />
    </>
  )
}
