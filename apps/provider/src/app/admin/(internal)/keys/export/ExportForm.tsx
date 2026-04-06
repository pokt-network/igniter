'use client'
import type {AddressGroupWithDetails, Delegator} from '@igniter/db/provider/schema'
import type {KeyExportFilters} from '@/lib/dal/keys'
import React, {useEffect, useRef, useState} from 'react'
import {useForm, useWatch} from 'react-hook-form'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@igniter/ui/components/select'
import {Dialog, DialogContent, DialogTitle, DialogFooter} from '@igniter/ui/components/dialog'
import {Button} from '@igniter/ui/components/button'
import {LoaderIcon} from '@igniter/ui/assets'
import {toCurrencyFormat} from '@igniter/ui/lib/utils'
import {CountKeysForExport, ExportKeys, ListDistinctOwnerAddresses} from '@/actions/Keys'
import {ListAddressGroups} from '@/actions/AddressGroups'
import {ListDelegators} from '@/actions/Delegators'
import {exportToJson, exportToRelayMinerHaYaml} from '@/app/admin/(internal)/keys/exportUtils'
import {KeyStateLabels} from "@/app/admin/(internal)/keys/constants"
import {KeyState} from "@igniter/db/provider/enums"


interface ExportFormProps {
  onClose: () => void
}

type ExportStatus = 'not_exported' | 'previously_exported' | 'all'
type ExportFormat = 'json' | 'relayminer-ha'

interface FilterFormValues {
  addressGroupId: string
  selectedStates: KeyState[]
  ownerAddress: string
  delegatorIdentity: string
  dateField: 'createdAt' | 'deliveredAt'
  dateFrom: string
  dateTo: string
  exportStatus: ExportStatus
  exportFormat: ExportFormat
}

function buildFilters(values: FilterFormValues): KeyExportFilters {
  const filters: KeyExportFilters = {}
  if (values.addressGroupId) filters.addressGroupId = Number(values.addressGroupId)
  if (values.selectedStates.length > 0) filters.states = values.selectedStates
  if (values.ownerAddress) filters.ownerAddress = values.ownerAddress
  if (values.delegatorIdentity) filters.delegatorIdentity = values.delegatorIdentity
  if (values.dateFrom) filters.dateFrom = new Date(values.dateFrom + 'T00:00:00.000Z')
  if (values.dateTo) {
    const to = new Date(values.dateTo + 'T23:59:59.999Z')
    filters.dateTo = to
  }
  if (values.dateFrom || values.dateTo) filters.dateField = values.dateField
  if (values.exportStatus !== 'all') filters.exportStatus = values.exportStatus
  return filters
}

export default function ExportForm({onClose}: ExportFormProps) {
  const [addressesGroup, setAddressesGroup] = useState<AddressGroupWithDetails[]>([])
  const [delegators, setDelegators] = useState<Delegator[]>([])
  const [ownerAddresses, setOwnerAddresses] = useState<string[]>([])
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [status, setStatus] = useState<'form' | 'success' | 'loading' | 'error'>('form')
  const [keysExported, setKeysExported] = useState(0)
  const [totalKeysCount, setTotalKeysCount] = useState<number | null>(null)
  const [isLoadingKeyCount, setIsLoadingKeyCount] = useState(false)

  useEffect(() => {
    Promise.all([ListAddressGroups(), ListDelegators(), ListDistinctOwnerAddresses()]).then(([ag, del, own]) => {
      if (ag.success) setAddressesGroup(ag.data)
      if (del.success) setDelegators(del.data)
      if (own.success) setOwnerAddresses(own.data)
      setIsDataLoading(false)
    })
  }, [])

  const {register, setValue, setError, formState: {errors}, control} = useForm<FilterFormValues>({
    defaultValues: {
      addressGroupId: '',
      selectedStates: [],
      ownerAddress: '',
      delegatorIdentity: '',
      dateField: 'createdAt',
      dateFrom: '',
      dateTo: '',
      exportStatus: 'all',
      exportFormat: 'json',
    },
  })

  const values = useWatch({control})

  const addressGroupId = values.addressGroupId ?? ''
  const selectedStates = values.selectedStates ?? []
  const ownerAddress = values.ownerAddress ?? ''
  const delegatorIdentity = values.delegatorIdentity ?? ''
  const dateField = values.dateField ?? 'createdAt'
  const dateFrom = values.dateFrom ?? ''
  const dateTo = values.dateTo ?? ''
  const exportStatus = values.exportStatus ?? 'all'
  const exportFormat = values.exportFormat ?? 'json'

  const statesKey = JSON.stringify(selectedStates)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setIsLoadingKeyCount(true)
      try {
        const result = await CountKeysForExport(buildFilters(values as FilterFormValues))
        if (!result || !result.success) throw new Error('Failed to fetch count')
        setTotalKeysCount(result.data)
      } catch {
        setTotalKeysCount(null)
      } finally {
        setIsLoadingKeyCount(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [addressGroupId, statesKey, ownerAddress, delegatorIdentity, dateFrom, dateTo, dateField, exportStatus])

  const handleStateToggle = (state: KeyState) => {
    const next = selectedStates.includes(state)
      ? selectedStates.filter(s => s !== state)
      : [...selectedStates, state]
    setValue('selectedStates', next)
  }

  const exportKeys = async () => {
    if (status === 'loading') return

    if (addressGroupId && !addressesGroup.some(g => g.id === Number(addressGroupId))) {
      setError('addressGroupId', {message: 'Selected group does not exist'})
      return
    }

    setStatus('loading')
    try {
      const filters = buildFilters(values as FilterFormValues)
      const result = await ExportKeys(filters)
      if (!result || !result.success) throw new Error('Failed to fetch keys')

      const exportedKeys = result.data
      const groupName = addressGroupId
        ? addressesGroup.find(a => a.id === Number(addressGroupId))?.name ?? 'keys'
        : 'all-groups'
      const timestamp = new Date().toISOString().replace(/[:.]/g, '_')

      if (exportFormat === 'relayminer-ha') {
        const filename = `${groupName}-keys-at-${timestamp}.yaml`
        exportToRelayMinerHaYaml(exportedKeys, filename)
      } else {
        const filename = `${groupName}-keys-at-${timestamp}.json`
        exportToJson(exportedKeys.map(k => ({hex: k.hex})), filename)
      }
      setKeysExported(exportedKeys.length)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  const getFilterSummary = (): string => {
    const parts: string[] = []
    if (addressGroupId) {
      const group = addressesGroup.find(a => a.id === Number(addressGroupId))
      if (group) parts.push(`Group: ${group.name}`)
    }
    if (selectedStates.length > 0) {
      parts.push(selectedStates.map(s => KeyStateLabels[s]).join(' + '))
    }
    if (ownerAddress) {
      parts.push(`Owner: ${ownerAddress.slice(0, 8)}...`)
    }
    if (delegatorIdentity) {
      const d = delegators.find(d => d.identity === delegatorIdentity)
      if (d) parts.push(`Delegator: ${d.name}`)
    }
    if (dateFrom || dateTo) {
      const field = dateField === 'createdAt' ? 'Created' : 'Delivered'
      if (dateFrom && dateTo) parts.push(`${field}: ${dateFrom} to ${dateTo}`)
      else if (dateFrom) parts.push(`${field} from: ${dateFrom}`)
      else parts.push(`${field} to: ${dateTo}`)
    }
    if (exportStatus === 'not_exported') parts.push('Not yet exported')
    else if (exportStatus === 'previously_exported') parts.push('Previously exported')
    return parts.length > 0 ? parts.join(' · ') : 'No filters applied'
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
        {/* Address Group */}
        <div>
          <div className="flex flex-row items-center gap-3">
            <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Address Group</label>
            <div className="flex-1">
              <Select value={addressGroupId} onValueChange={(v) => setValue('addressGroupId', v === '__all__' ? '' : v, {shouldValidate: true})}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Groups"/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Groups</SelectItem>
                  {addressesGroup.map(group => (
                    <SelectItem value={group.id.toString()} key={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {errors.addressGroupId && (
            <p className="text-xs text-red-500">{errors.addressGroupId.message}</p>
          )}
        </div>

        {/* Key States */}
        <div className="flex flex-row items-start gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary pt-1">Key State</label>
          <div className="flex flex-wrap gap-2 flex-1">
            {Object.entries(KeyStateLabels).map(([value, label]) => {
              const state = value as KeyState
              const isSelected = selectedStates.includes(state)
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleStateToggle(state)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Owner Address */}
        {ownerAddresses.length > 0 && (
          <div className="flex flex-row items-center gap-3">
            <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Owner Address</label>
            <div className="flex-1">
              <Select value={ownerAddress} onValueChange={(v) => setValue('ownerAddress', v === '__all__' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Owners"/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Owners</SelectItem>
                  {ownerAddresses.map(addr => (
                    <SelectItem value={addr} key={addr}>
                      {addr.slice(0, 12)}...{addr.slice(-6)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Delegator */}
        {delegators.length > 0 && (
          <div className="flex flex-row items-center gap-3">
            <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Delegator</label>
            <div className="flex-1">
              <Select value={delegatorIdentity} onValueChange={(v) => setValue('delegatorIdentity', v === '__all__' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Delegators"/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Delegators</SelectItem>
                  {delegators.map(d => (
                    <SelectItem value={d.identity} key={d.identity}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Date Range */}
        <div className="flex flex-row items-start gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary pt-1">Date Range</label>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  value="createdAt"
                  checked={dateField === 'createdAt'}
                  {...register('dateField')}
                  className="accent-blue-600"
                />
                Created
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  value="deliveredAt"
                  checked={dateField === 'deliveredAt'}
                  {...register('dateField')}
                  className="accent-blue-600"
                />
                Delivered
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                {...register('dateFrom')}
                className="flex-1 h-9 rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground"
              />
              <span className="text-sm text-text-secondary">to</span>
              <input
                type="date"
                {...register('dateTo')}
                className="flex-1 h-9 rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground"
              />
            </div>
          </div>
        </div>

        {/* Export Status */}
        <div className="flex flex-row items-start gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary pt-1">Export Status</label>
          <div className="flex items-center gap-4 flex-1">
            {([
              ['all', 'All'],
              ['not_exported', 'Not yet exported'],
              ['previously_exported', 'Previously exported'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  value={value}
                  checked={exportStatus === value}
                  {...register('exportStatus')}
                  className="accent-blue-600"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className={`p-4 rounded-md border transition-colors ${
          isLoadingKeyCount
            ? 'bg-bg-elevated border-border'
            : totalKeysCount && totalKeysCount > 0
              ? 'bg-emerald-500/5 border-emerald-500/30'
              : 'bg-yellow-500/5 border-yellow-500/30'
        }`}>
          <div className="space-y-2">
            <div className="text-xs text-text-tertiary">
              {getFilterSummary()}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-secondary">Keys to Export</span>
              <span className={`text-sm font-medium ${
                isLoadingKeyCount ? '' : totalKeysCount && totalKeysCount > 0 ? 'text-emerald-400' : 'text-yellow-500'
              }`}>
                {isLoadingKeyCount ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />
                ) : totalKeysCount !== null ? (
                  toCurrencyFormat(totalKeysCount, 0, 0)
                ) : (
                  "Failed to load"
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Export Format */}
        <div className="flex flex-row items-start gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary pt-1">Format</label>
          <div className="flex items-center gap-4 flex-1">
            {([
              ['json', 'JSON'],
              ['relayminer-ha', 'RelayMiner HA'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  value={value}
                  checked={exportFormat === value}
                  {...register('exportFormat')}
                  className="accent-blue-600"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Example output — collapsible */}
        <details className="group">
          <summary className="text-sm text-text-secondary cursor-pointer select-none hover:text-text-primary transition-colors">
            Example output
          </summary>
          {exportFormat === 'json' ? (
            <div className="mt-2 rounded-lg border border-border bg-[#0d1117] p-4 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre">
              <span className="text-[#8b949e]">{'['}</span>{'\n'}
              {'  '}<span className="text-[#8b949e]">{'{'}</span>{'\n'}
              {'    '}<span className="text-[#7ee787]">{'"hex"'}</span><span className="text-[#8b949e]">:</span> <span className="text-[#a5d6ff]">{'"<pk1>"'}</span>{'\n'}
              {'  '}<span className="text-[#8b949e]">{'}'}</span><span className="text-[#8b949e]">,</span>{'\n'}
              {'  '}<span className="text-[#8b949e]">{'{'}</span>{'\n'}
              {'    '}<span className="text-[#7ee787]">{'"hex"'}</span><span className="text-[#8b949e]">:</span> <span className="text-[#a5d6ff]">{'"<pk2>"'}</span>{'\n'}
              {'  '}<span className="text-[#8b949e]">{'}'}</span>{'\n'}
              <span className="text-[#8b949e]">{']'}</span>
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-border bg-[#0d1117] p-4 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre">
              <span className="text-[#7ee787]">keys</span><span className="text-[#8b949e]">:</span>{'\n'}
              {'  '}<span className="text-[#8b949e]"># supplier1 - pokt1abc...xyz</span>{'\n'}
              {'  '}<span className="text-[#8b949e]">-</span> <span className="text-[#a5d6ff]">{'"<pk1>"'}</span>{'\n'}
              {'  '}<span className="text-[#8b949e]"># supplier2 - pokt1def...uvw</span>{'\n'}
              {'  '}<span className="text-[#8b949e]">-</span> <span className="text-[#a5d6ff]">{'"<pk2>"'}</span>
            </div>
          )}
        </details>
      </>
    )
  } else if (status === 'success') {
    content = (
      <>
        <div className="relative flex h-[64px] mt-[-5px] gradient-border-green">
          <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
            <span className="text-[20px] text-text-secondary">Keys Exported</span>
            <div className="flex flex-row items-center gap-2">
              <p className="font-mono !text-[20px]">{toCurrencyFormat(keysExported, 0, 0)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-primary p-[11px_16px]">
            You have successfully exported {keysExported} keys.
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
            <span className="text-sm font-semibold">Export Keys</span>
          </div>
        </DialogTitle>
        <div className="h-px bg-border-primary" />

        <div className="flex flex-col gap-5 p-6 overflow-y-auto max-h-[calc(85vh-110px)]">
          {content}
        </div>

        <div className="h-px bg-border-primary" />
        <DialogFooter className="px-5 py-3 flex flex-row items-center gap-2">
          {(status === 'form' || status === 'loading') && (
            <>
              <div className="flex-1" />
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={exportKeys}
                disabled={status === 'loading' || !totalKeysCount || totalKeysCount <= 0}
              >
                {status === 'loading' && <LoaderIcon className="animate-spin"/>}
                {status === 'form' && 'Export Keys'}
              </Button>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="flex-1" />
              <Button onClick={onClose}>
                Close
              </Button>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="flex-1" />
              <Button
                disabled={!totalKeysCount || totalKeysCount <= 0}
                onClick={exportKeys}
              >
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
