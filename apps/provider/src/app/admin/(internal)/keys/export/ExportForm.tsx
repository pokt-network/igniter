'use client'
import type {AddressGroupWithDetails, Delegator} from '@igniter/db/provider/schema'
import type {KeyExportFilters} from '@/lib/dal/keys'
import {useRouter} from 'next/navigation'
import React, {useEffect, useState} from 'react'
import {useForm, useWatch} from 'react-hook-form'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@igniter/ui/components/select'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'
import {ActivityHeader} from '@igniter/ui/components/ActivityHeader'
import {AbortConfirmationDialog} from '@igniter/ui/components/AbortConfirmationDialog'
import {Button} from '@igniter/ui/components/button'
import {LoaderIcon} from '@igniter/ui/assets'
import {toCurrencyFormat} from '@igniter/ui/lib/utils'
import {CountKeysForExport, ExportKeys} from '@/actions/Keys'
import {exportToJson} from '@/app/admin/(internal)/keys/exportUtils'
import {KeyStateLabels} from "@/app/admin/(internal)/keys/constants"
import {KeyState} from "@igniter/db/provider/enums"


interface ExportFormProps {
  addressesGroup: AddressGroupWithDetails[]
  delegators: Delegator[]
  ownerAddresses: string[]
}

type ExportStatus = 'not_exported' | 'previously_exported' | 'all'

interface FilterFormValues {
  addressGroupId: string
  selectedStates: KeyState[]
  ownerAddress: string
  delegatorIdentity: string
  dateField: 'createdAt' | 'deliveredAt'
  dateFrom: string
  dateTo: string
  exportStatus: ExportStatus
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

export default function ExportForm({addressesGroup, delegators, ownerAddresses}: ExportFormProps) {
  const router = useRouter()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [isAbortDialogOpen, setAbortDialogOpen] = useState(false)
  const [status, setStatus] = useState<'form' | 'success' | 'loading' | 'error'>('form')
  const [keysExported, setKeysExported] = useState(0)
  const [totalKeysCount, setTotalKeysCount] = useState<number | null>(null)
  const [isLoadingKeyCount, setIsLoadingKeyCount] = useState(false)

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

  useEffect(() => {
    const fetchCount = async () => {
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
    }
    fetchCount()
  }, [addressGroupId, selectedStates, ownerAddress, delegatorIdentity, dateFrom, dateTo, dateField, exportStatus])

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

      const privateKeys = result.data
      const groupName = addressGroupId
        ? addressesGroup.find(a => a.id === Number(addressGroupId))?.name ?? 'keys'
        : 'all-groups'
      const filename = `${groupName}-keys-at-${new Date().toISOString().replace(/[:.]/g, '_')}.json`

      exportToJson(privateKeys, filename)
      setKeysExported(privateKeys.length)
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

  if (status === 'form' || status === 'loading') {
    content = (
      <>
        {/* Address Group */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-secondary">Address Group</label>
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
          {errors.addressGroupId && (
            <p className="text-xs text-red-500">{errors.addressGroupId.message}</p>
          )}
        </div>

        {/* Key States */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-secondary">Key State</label>
          <div className="flex flex-wrap gap-2">
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
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">Owner Address</label>
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
        )}

        {/* Delegator */}
        {delegators.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">Delegator</label>
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
        )}

        {/* Date Range */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-secondary">Date Range</label>
          <div className="flex items-center gap-4 mb-2">
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

        {/* Export Status */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-secondary">Export Status</label>
          <div className="flex items-center gap-4">
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
        <div className="p-4 rounded-md bg-bg-elevated">
          <div className="space-y-2">
            <div className="text-xs text-text-tertiary">
              {getFilterSummary()}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-secondary">Keys to Export</span>
              <span className="text-sm">
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

        <p>
          Example output:
          <br/>
          <div className="p-4 rounded-md bg-bg-elevated mt-2">
            <pre className="whitespace-pre-wrap">{JSON.stringify([{hex: '<pk1>'}, {hex: '<pk2>'}], null, 2)}</pre>
          </div>
        </p>

        <Button
          className="w-full h-[40px]"
          onClick={exportKeys}
          disabled={status === 'loading' || !totalKeysCount || totalKeysCount <= 0}
        >
          {status === 'loading' && <LoaderIcon className="animate-spin"/>}
          {status === 'form' && 'Export Keys'}
        </Button>
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

        <Button
          className="w-full h-[40px]"
          onClick={() => {
            setIsRedirecting(true)
            router.push('/admin/keys')
          }}
        >
          {isRedirecting && <LoaderIcon className="animate-spin"/>}
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

        <Button
          disabled={!totalKeysCount || totalKeysCount <= 0}
          className="w-full h-[40px]"
          onClick={exportKeys}
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
              title="Export Keys"
              subtitle={status === 'success' ? '' : 'Configure filters and export your keys as a JSON file.'}
              onClose={() => setAbortDialogOpen(true)}
              isDisabled={status === 'success'}
            />
            {content}
          </div>
        </div>
      </OverrideSidebar>
      <AbortConfirmationDialog
        type="export"
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
