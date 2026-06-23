'use client'

import React, { useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@igniter/ui/components/dialog'
import { Button } from '@igniter/ui/components/button'
import { Checkbox } from '@igniter/ui/components/checkbox'
import { LoaderIcon } from '@igniter/ui/assets'
import { AlertTriangle } from 'lucide-react'
import { CountKeysForUnstake, UnstakeKeys, ListUnstakeAddresses } from '@/actions/Unstake'
import Address from '@igniter/ui/components/Address'
import { copyToClipboard } from '@igniter/ui/lib/utils'
import { type ReturnFundsInput } from '@/lib/unstakeValidation'
import { ListAddressGroups } from '@/actions/AddressGroups'
import { ListRelayMiners } from '@/actions/RelayMiners'
import { ListDistinctOwnerAddresses } from '@/actions/Keys'
import type { UnstakeFilters } from '@/lib/dal/keys'
import { useKeysSelection } from '@/app/admin/(internal)/keys/KeysSelectionContext'

type Status = 'form' | 'confirm' | 'progress' | 'done' | 'error'

interface UnstakeFilterValues {
  addressGroupId: string
  relayMinerId: string
  ownerAddress: string
}

function buildFilters(values: UnstakeFilterValues): UnstakeFilters {
  const f: UnstakeFilters = {}
  if (values.addressGroupId) f.addressGroupId = Number(values.addressGroupId)
  if (values.relayMinerId) f.relayMinerId = Number(values.relayMinerId)
  if (values.ownerAddress) f.ownerAddress = values.ownerAddress
  return f
}

interface UnstakeFormProps {
  onClose: () => void
  returnFundsDefault: boolean
}

export default function UnstakeForm({ onClose, returnFundsDefault }: UnstakeFormProps) {
  const [status, setStatus] = useState<Status>('form')
  const [error, setError] = useState<string | null>(null)
  const [rfMode, setRfMode] = useState<'none' | 'owner' | 'custom'>(returnFundsDefault ? 'owner' : 'none')
  const [customAddr, setCustomAddr] = useState('')
  const [ack1, setAck1] = useState(false)
  const [ack2, setAck2] = useState(false)
  const [result, setResult] = useState<{ accepted: number; skipped: number } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  const queryClient = useQueryClient()
  const { selectedKeyIds, clearSelection } = useKeysSelection()
  const hasSelection = selectedKeyIds.length > 0

  const { control, setValue } = useForm<UnstakeFilterValues>({
    defaultValues: { addressGroupId: '', relayMinerId: '', ownerAddress: '' },
  })
  const values = useWatch({ control }) as UnstakeFilterValues

  const filters = buildFilters(values)
  const filtersKey = JSON.stringify(filters)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [debouncedFilters, setDebouncedFilters] = useState<UnstakeFilters>(filters)

  React.useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedFilters(buildFilters(values)), 300)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  // When a row selection is active, the effective filters are keyIds-only.
  // Otherwise, fall back to the debounced filter-based query.
  const effectiveFilters: UnstakeFilters = hasSelection
    ? { keyIds: selectedKeyIds }
    : debouncedFilters

  // Form data (address groups, relay miners, owner addresses)
  const { data: formData, isLoading: isDataLoading } = useQuery({
    queryKey: ['unstake-form-data'],
    queryFn: async () => {
      const [ag, rm, own] = await Promise.all([
        ListAddressGroups(),
        ListRelayMiners(),
        ListDistinctOwnerAddresses(),
      ])
      return {
        addressGroups: ag.success ? ag.data : [],
        relayMiners: rm.success ? rm.data : [],
        ownerAddresses: own.success ? own.data : [],
      }
    },
    staleTime: 30_000,
  })

  const addressGroups = formData?.addressGroups ?? []
  const relayMiners = formData?.relayMiners ?? []
  const ownerAddresses = formData?.ownerAddresses ?? []

  // When rows are selected, the count is known instantly (selectedKeyIds.length).
  // When using filters, query the server with the debounced filter state.
  const { data: filteredCount = 0, isFetching } = useQuery({
    queryKey: ['unstake-count', effectiveFilters],
    queryFn: async () => {
      const r = await CountKeysForUnstake(effectiveFilters)
      if (!r.success) throw new Error(r.error.message)
      return r.data
    },
    staleTime: 0,
    // Skip the query when selection is active — we already know the count.
    enabled: !hasSelection,
  })

  const count = hasSelection ? selectedKeyIds.length : filteredCount

  const returnFunds: ReturnFundsInput =
    rfMode === 'none' ? { mode: 'none' } : rfMode === 'owner' ? { mode: 'owner' } : { mode: 'custom', address: customAddr }

  const submit = async () => {
    setStatus('progress')
    setError(null)
    const r = await UnstakeKeys({ filters: effectiveFilters, returnFunds })
    if (!r.success) { setError(r.error.message); setStatus('error'); return }
    setResult(r.data)
    clearSelection()
    setStatus('done')
    queryClient.invalidateQueries({ queryKey: ['keys-pending-unstake'] })
    queryClient.invalidateQueries({ queryKey: ['keys-pending-state'] })
    queryClient.invalidateQueries({ queryKey: ['keys'] })
  }

  const canProceed = count > 0 && !(rfMode === 'custom' && !customAddr.trim())

  let content: React.ReactNode

  if (status === 'form' && isDataLoading) {
    content = (
      <div className="flex items-center justify-center py-12">
        <LoaderIcon className="animate-spin h-6 w-6 text-text-secondary" />
      </div>
    )
  } else if (status === 'form') {
    content = (
      <>
        {/* Selection mode banner */}
        {hasSelection && (
          <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs text-blue-400">
            Unstaking {selectedKeyIds.length} selected supplier(s). Filters below are ignored.
          </div>
        )}

        {/* Address Group filter */}
        <div className={`flex flex-row items-center gap-3 ${hasSelection ? 'opacity-40 pointer-events-none' : ''}`}>
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Address Group</label>
          <div className="flex-1">
            <Select value={values.addressGroupId ?? ''} onValueChange={(v) => setValue('addressGroupId', v === '__all__' ? '' : v)} disabled={hasSelection}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Groups</SelectItem>
                {addressGroups.map((g) => (
                  <SelectItem value={g.id.toString()} key={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Relay Miner filter */}
        {relayMiners.length > 0 && (
          <div className={`flex flex-row items-center gap-3 ${hasSelection ? 'opacity-40 pointer-events-none' : ''}`}>
            <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Relay Miner</label>
            <div className="flex-1">
              <Select value={values.relayMinerId ?? ''} onValueChange={(v) => setValue('relayMinerId', v === '__all__' ? '' : v)} disabled={hasSelection}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Relay Miners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Relay Miners</SelectItem>
                  {relayMiners.map((rm) => (
                    <SelectItem value={rm.id.toString()} key={rm.id}>{rm.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Owner Address filter */}
        {ownerAddresses.length > 0 && (
          <div className={`flex flex-row items-center gap-3 ${hasSelection ? 'opacity-40 pointer-events-none' : ''}`}>
            <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Owner Address</label>
            <div className="flex-1">
              <Select value={values.ownerAddress ?? ''} onValueChange={(v) => setValue('ownerAddress', v === '__all__' ? '' : v)} disabled={hasSelection}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Owners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Owners</SelectItem>
                  {ownerAddresses.map((addr) => (
                    <SelectItem value={addr} key={addr}>{addr.slice(0, 12)}...{addr.slice(-6)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Return funds tri-state */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-text-secondary font-medium">Return operator funds</span>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="unstake-modal-rfMode" value="none" checked={rfMode === 'none'} onChange={() => setRfMode('none')} />
              Do not return funds
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="unstake-modal-rfMode" value="owner" checked={rfMode === 'owner'} onChange={() => setRfMode('owner')} />
              Return to owner address
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="unstake-modal-rfMode" value="custom" checked={rfMode === 'custom'} onChange={() => setRfMode('custom')} />
              Return to custom address
            </label>
          </div>
          {rfMode === 'custom' && (
            <input
              type="text"
              className="w-full rounded-md border border-border bg-bg-root px-3 py-2 text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border"
              placeholder="pokt1..."
              value={customAddr}
              onChange={(e) => setCustomAddr(e.target.value)}
            />
          )}
        </div>

        {/* Live count summary */}
        <div className={`p-4 rounded-md border transition-colors ${
          (!hasSelection && isFetching)
            ? 'bg-bg-elevated border-border'
            : count > 0
              ? 'bg-emerald-500/5 border-emerald-500/30'
              : 'bg-yellow-500/5 border-yellow-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-text-secondary text-sm">Suppliers to unstake</span>
            <span className={`text-sm font-medium ${(!hasSelection && isFetching) ? '' : count > 0 ? 'text-emerald-400' : 'text-yellow-500'}`}>
              {(!hasSelection && isFetching)
                ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />
                : count}
            </span>
          </div>
        </div>
      </>
    )
  } else if (status === 'confirm') {
    const handleCopyAddresses = async () => {
      const r = await ListUnstakeAddresses(effectiveFilters)
      if (!r.success) { setCopyState('error'); setTimeout(() => setCopyState('idle'), 1500); return }
      await copyToClipboard(r.data.join('\n'))
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1500)
    }

    content = (
      <div className="flex flex-col gap-4">
        {/* Summary card */}
        <div className="rounded-md border border-border-primary bg-bg-elevated divide-y divide-border-primary">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-text-secondary">Suppliers to unstake</span>
            <span className="font-semibold">{count}</span>
          </div>
          <div className="flex items-start justify-between px-4 py-3 text-sm gap-4">
            <span className="text-text-secondary shrink-0">Return funds</span>
            <div className="flex flex-col items-end gap-1">
              {rfMode === 'none' && <span className="font-semibold">No</span>}
              {rfMode === 'owner' && (
                <>
                  <span className="font-semibold">To owner</span>
                  {values.ownerAddress && (
                    <Address address={values.ownerAddress} full />
                  )}
                </>
              )}
              {rfMode === 'custom' && customAddr && (
                <Address address={customAddr} full />
              )}
              {rfMode === 'custom' && !customAddr && (
                <span className="font-semibold text-yellow-400">—</span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-secondary">{count} affected supplier address{count !== 1 ? 'es' : ''}</span>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={handleCopyAddresses}
            >
              {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Error' : `Copy ${count} addresses`}
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2.5 p-3 rounded-md bg-red-500/10 border border-red-500/40">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-red-400" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-red-200">This action cannot be undone.</span>
            <span className="text-xs text-red-300/80">This will schedule unstake transactions for {count} supplier(s).</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 text-sm cursor-pointer text-text-primary">
            <Checkbox checked={ack1} onCheckedChange={(v) => setAck1(!!v)} className="size-5 shrink-0 border-2 border-amber-400 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500" />
            I understand {count} supplier(s) will be unstaked from the network.
          </label>
          <label className="flex items-center gap-3 text-sm cursor-pointer text-text-primary">
            <Checkbox checked={ack2} onCheckedChange={(v) => setAck2(!!v)} className="size-5 shrink-0 border-2 border-amber-400 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500" />
            I understand this is part of the supplier lifecycle and these keys will be retired.
          </label>
        </div>
      </div>
    )
  } else if (status === 'progress') {
    content = (
      <div className="flex items-center justify-center py-12">
        <LoaderIcon className="animate-spin h-6 w-6 text-text-secondary" />
      </div>
    )
  } else if (status === 'done') {
    content = (
      <>
        <div className="relative flex h-[64px] mt-[-5px] gradient-border-green">
          <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
            <span className="text-[20px] text-text-secondary">Unstake Scheduled</span>
            <p className="font-mono !text-[20px]">{result?.accepted ?? 0}</p>
          </div>
        </div>
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-primary p-[11px_16px]">
            {result?.accepted ?? 0} supplier(s) queued for unstaking.
            {(result?.skipped ?? 0) > 0 && ` ${result!.skipped} already in progress (skipped).`}
            {rfMode !== 'none' && ' Funds will be returned automatically once the unbonding period completes.'}
          </span>
        </div>
      </>
    )
  } else {
    content = (
      <div className="flex flex-col gap-3">
        <div className="relative flex h-[64px] mt-[-5px] gradient-border-red">
          <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px]">
            <span className="text-[20px] text-text-secondary">Oops! Something went wrong.</span>
          </div>
        </div>
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
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
            <span className="text-sm font-semibold">Unstake suppliers</span>
          </div>
        </DialogTitle>
        <div className="h-px bg-border-primary" />

        <div className="flex flex-col gap-5 p-6 overflow-y-auto max-h-[calc(85vh-110px)]">
          {content}
        </div>

        <div className="h-px bg-border-primary" />
        <DialogFooter className="px-5 py-3 flex flex-row items-center gap-2">
          {status === 'form' && (
            <>
              <div className="flex-1" />
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={!canProceed} onClick={() => setStatus('confirm')}>
                Review ({count})
              </Button>
            </>
          )}
          {status === 'confirm' && (
            <>
              <div className="flex-1" />
              <Button variant="outline" onClick={() => { setStatus('form'); setAck1(false); setAck2(false) }}>Back</Button>
              <Button className="bg-red-600 text-white border-transparent hover:bg-red-700" disabled={!ack1 || !ack2} onClick={submit}>Unstake</Button>
            </>
          )}
          {status === 'progress' && (
            <>
              <div className="flex-1" />
              <Button disabled>
                <LoaderIcon className="animate-spin" />
              </Button>
            </>
          )}
          {status === 'done' && (
            <>
              <div className="flex-1" />
              <Button onClick={onClose}>Close</Button>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="flex-1" />
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={!canProceed} onClick={submit}>Try Again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
