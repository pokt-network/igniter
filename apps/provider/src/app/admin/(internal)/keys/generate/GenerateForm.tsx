'use client'
import type { AddressGroupWithDetails } from '@igniter/db/provider/schema'
import React, { useState, useEffect } from 'react'
import { ListAddressGroups } from '@/actions/AddressGroups'
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
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter
} from '@igniter/ui/components/dialog'
import { GenerateKeys } from '@/actions/Keys'
import {exportToJson} from '@/app/admin/(internal)/keys/exportUtils'


interface GenerateFormProps {
  onClose: () => void
}

export default function GenerateForm({ onClose }: GenerateFormProps) {
  const [addressesGroup, setAddressesGroup] = useState<AddressGroupWithDetails[]>([])
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [status, setStatus] = useState<'form' | 'loading' | 'success' | 'error'>('form')
  const [addressGroup, setAddressGroup] = useState<string>('')
  const [keyCount, setKeyCount] = useState<string>('')
  const [keysGenerated, setKeysGenerated] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    ListAddressGroups().then(result => {
      if (result.success) setAddressesGroup(result.data)
      setIsDataLoading(false)
    })
  }, [])

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

  if (isDataLoading) {
    content = (
      <div className="flex items-center justify-center py-12">
        <LoaderIcon className="animate-spin h-6 w-6 text-text-secondary" />
      </div>
    )
  } else if (status === 'form' || status === 'loading') {
    content = (
      <>
        <div className="flex flex-row items-center gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Address Group</label>
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
        </div>

        <div className="flex flex-row items-center gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Number of Keys</label>
          <input
            type="number"
            min={1}
            max={10000}
            value={keyCount}
            onChange={(e) => setKeyCount(e.target.value)}
            placeholder="1 - 10,000"
            className="w-full h-9 rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[color:--color-blue-1]"
          />
        </div>

        {addressGroup && isValidCount && (
          <div className="rounded-md border border-border-primary bg-bg-elevated">
            <div className="flex flex-row items-center gap-3 px-4 py-2.5 border-b border-border-primary">
              <span className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Address Group</span>
              <span className="text-sm">{addressesGroup.find(g => g.id.toString() === addressGroup)?.name}</span>
            </div>
            <div className="flex flex-row items-center gap-3 px-4 py-2.5 border-b border-border-primary">
              <span className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Keys to Generate</span>
              <span className="text-sm">{toCurrencyFormat(parsedCount, 0, 0)}</span>
            </div>
            <div className="flex flex-row items-center gap-3 px-4 py-2.5">
              <span className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Initial State</span>
              <span className="text-sm">Available</span>
            </div>
          </div>
        )}

        <details className="group">
          <summary className="text-sm text-text-secondary cursor-pointer select-none hover:text-text-primary transition-colors">
            Example output
          </summary>
          <div className="mt-2 rounded-lg border border-border bg-[#0d1117] p-4 font-mono text-xs leading-relaxed overflow-x-auto">
            <span className="text-[#8b949e]">{'['}</span>{'\n'}
            {'  '}<span className="text-[#8b949e]">{'{'}</span>{'\n'}
            {'    '}<span className="text-[#7ee787]">{'"hex"'}</span><span className="text-[#8b949e]">:</span> <span className="text-[#a5d6ff]">{'"<pk1>"'}</span>{'\n'}
            {'  '}<span className="text-[#8b949e]">{'}'}</span><span className="text-[#8b949e]">,</span>{'\n'}
            {'  '}<span className="text-[#8b949e]">{'{'}</span>{'\n'}
            {'    '}<span className="text-[#7ee787]">{'"hex"'}</span><span className="text-[#8b949e]">:</span> <span className="text-[#a5d6ff]">{'"<pk2>"'}</span>{'\n'}
            {'  '}<span className="text-[#8b949e]">{'}'}</span>{'\n'}
            <span className="text-[#8b949e]">{']'}</span>
          </div>
        </details>

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
          <div className="flex flex-row justify-between items-center py-3 px-5">
            <span className="text-sm font-semibold">Generate Keys</span>
          </div>
        </DialogTitle>
        <div className="h-px bg-border-primary" />

        <div className="flex flex-col gap-5 p-6 overflow-y-auto max-h-[calc(85vh-110px)]">
          {content}
        </div>

        <DialogFooter className="flex flex-row justify-end gap-2 px-5 py-3 border-t border-border-primary">
          {status === 'success' ? (
            <Button onClick={onClose}>
              Close
            </Button>
          ) : status === 'error' ? (
            <>
              <Button variant="outline" onClick={() => onClose()}>
                Cancel
              </Button>
              <Button onClick={handleGenerate}>
                Try Again
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onClose()}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={status === 'loading' || !addressGroup || !isValidCount}
              >
                {status === 'loading' && <LoaderIcon className="animate-spin" />}
                {status === 'form' && 'Generate & Download Keys'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
