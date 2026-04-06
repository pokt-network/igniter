'use client'
import type { KeyMigrationFilters } from '@/lib/dal/keys'
import React, { useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@igniter/ui/components/dialog'
import { Button } from '@igniter/ui/components/button'
import { LoaderIcon } from '@igniter/ui/assets'
import { toCurrencyFormat } from '@igniter/ui/lib/utils'
import { CountKeysForMigration, MigrateKeysToAddressGroup, ListDistinctOwnerAddresses } from '@/actions/Keys'
import { ListAddressGroups } from '@/actions/AddressGroups'
import { ListDelegators } from '@/actions/Delegators'
import { KeyStateLabels } from '@/app/admin/(internal)/keys/constants'
import { KeyState } from '@igniter/db/provider/enums'

interface MigrateFormProps {
  onClose: () => void
}

interface FilterFormValues {
  addressGroupId: string
  selectedStates: KeyState[]
  ownerAddress: string
  delegatorIdentity: string
  targetAddressGroupId: string
}

function buildFilters(values: FilterFormValues): KeyMigrationFilters {
  const filters: KeyMigrationFilters = {}
  if (values.addressGroupId) filters.addressGroupId = Number(values.addressGroupId)
  if (values.selectedStates.length > 0) filters.states = values.selectedStates
  if (values.ownerAddress) filters.ownerAddress = values.ownerAddress
  if (values.delegatorIdentity) filters.delegatorIdentity = values.delegatorIdentity
  return filters
}

export default function MigrateForm({ onClose }: MigrateFormProps) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'form' | 'loading' | 'success' | 'error'>('form')
  const [keysMigrated, setKeysMigrated] = useState(0)

  const { data: formData, isLoading: isDataLoading } = useQuery({
    queryKey: ['migrate-form-data'],
    queryFn: async () => {
      const [ag, del, own] = await Promise.all([
        ListAddressGroups(),
        ListDelegators(),
        ListDistinctOwnerAddresses(),
      ])
      return {
        addressesGroup: ag.success ? ag.data : [],
        delegators: del.success ? del.data : [],
        ownerAddresses: own.success ? own.data : [],
      }
    },
    staleTime: 30_000,
  })

  const addressesGroup = formData?.addressesGroup ?? []
  const delegators = formData?.delegators ?? []
  const ownerAddresses = formData?.ownerAddresses ?? []

  const { setValue, control } = useForm<FilterFormValues>({
    defaultValues: {
      addressGroupId: '',
      selectedStates: [],
      ownerAddress: '',
      delegatorIdentity: '',
      targetAddressGroupId: '',
    },
  })

  const values = useWatch({ control })

  const addressGroupId = values.addressGroupId ?? ''
  const selectedStates = values.selectedStates ?? []
  const ownerAddress = values.ownerAddress ?? ''
  const delegatorIdentity = values.delegatorIdentity ?? ''
  const targetAddressGroupId = values.targetAddressGroupId ?? ''

  const filters = buildFilters(values as FilterFormValues)
  const filtersKey = JSON.stringify(filters)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const [debouncedFilters, setDebouncedFilters] = useState<KeyMigrationFilters>(filters)

  React.useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedFilters(filters), 300)
    return () => clearTimeout(debounceRef.current)
  }, [filtersKey])

  const { data: totalKeysCount, isFetching: isLoadingKeyCount } = useQuery({
    queryKey: ['migrate-keys-count', debouncedFilters],
    queryFn: async () => {
      const result = await CountKeysForMigration(debouncedFilters)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    staleTime: 0,
  })

  const handleStateToggle = (state: KeyState) => {
    const next = selectedStates.includes(state)
      ? selectedStates.filter((s) => s !== state)
      : [...selectedStates, state]
    setValue('selectedStates', next)
  }

  const migrateKeys = async () => {
    if (status === 'loading' || !targetAddressGroupId) return
    setStatus('loading')
    try {
      const result = await MigrateKeysToAddressGroup(filters, Number(targetAddressGroupId))
      if (!result || !result.success) throw new Error(result?.error?.message ?? 'Failed to migrate keys')
      setKeysMigrated(result.data)
      await queryClient.invalidateQueries({ queryKey: ['keys'] })
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  const getFilterSummary = (): string => {
    const parts: string[] = []
    if (addressGroupId) {
      const group = addressesGroup.find((a) => a.id === Number(addressGroupId))
      if (group) parts.push(`Group: ${group.name}`)
    }
    if (selectedStates.length > 0) {
      parts.push(selectedStates.map((s) => KeyStateLabels[s]).join(' + '))
    }
    if (ownerAddress) parts.push(`Owner: ${ownerAddress.slice(0, 8)}...`)
    if (delegatorIdentity) {
      const d = delegators.find((d) => d.identity === delegatorIdentity)
      if (d) parts.push(`Delegator: ${d.name}`)
    }
    return parts.length > 0 ? parts.join(' · ') : 'No filters applied'
  }

  const targetGroup = addressesGroup.find((g) => g.id === Number(targetAddressGroupId))
  const canMigrate = !!targetAddressGroupId && !!totalKeysCount && totalKeysCount > 0

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
        {/* Source Address Group */}
        <div className="flex flex-row items-center gap-3">
          <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Source Group</label>
          <div className="flex-1">
            <Select value={addressGroupId} onValueChange={(v) => setValue('addressGroupId', v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Groups</SelectItem>
                {addressesGroup.map((group) => (
                  <SelectItem value={group.id.toString()} key={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                  <SelectValue placeholder="All Owners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Owners</SelectItem>
                  {ownerAddresses.map((addr) => (
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
                  <SelectValue placeholder="All Delegators" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Delegators</SelectItem>
                  {delegators.map((d) => (
                    <SelectItem value={d.identity} key={d.identity}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className={`p-4 rounded-md border transition-colors ${
          isLoadingKeyCount
            ? 'bg-bg-elevated border-border'
            : totalKeysCount && totalKeysCount > 0
              ? 'bg-emerald-500/5 border-emerald-500/30'
              : 'bg-yellow-500/5 border-yellow-500/30'
        }`}>
          <div className="space-y-2">
            <div className="text-xs text-text-tertiary">{getFilterSummary()}</div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-secondary">Keys to Migrate</span>
              <span className={`text-sm font-medium ${
                isLoadingKeyCount ? '' : totalKeysCount && totalKeysCount > 0 ? 'text-emerald-400' : 'text-yellow-500'
              }`}>
                {isLoadingKeyCount ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />
                ) : totalKeysCount !== null && totalKeysCount !== undefined ? (
                  toCurrencyFormat(totalKeysCount, 0, 0)
                ) : (
                  'Failed to load'
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Target Address Group */}
        <div>
          <div className="flex flex-row items-center gap-3">
            <label className="text-xs shrink-0 whitespace-nowrap w-28 text-text-secondary">Target Group</label>
            <div className="flex-1">
              <Select value={targetAddressGroupId} onValueChange={(v) => setValue('targetAddressGroupId', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select target group" />
                </SelectTrigger>
                <SelectContent>
                  {addressesGroup
                    .filter((g) => g.id.toString() !== addressGroupId)
                    .map((group) => (
                      <SelectItem value={group.id.toString()} key={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {targetGroup && (
            <p className="text-xs text-text-tertiary mt-1 pl-[calc(112px+0.75rem)]">
              Migrated keys will be queued for remediation to match this group&apos;s service configuration.
            </p>
          )}
        </div>
      </>
    )
  } else if (status === 'success') {
    content = (
      <>
        <div className="relative flex h-[64px] mt-[-5px] gradient-border-green">
          <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
            <span className="text-[20px] text-text-secondary">Keys Migrated</span>
            <p className="font-mono !text-[20px]">{toCurrencyFormat(keysMigrated, 0, 0)}</p>
          </div>
        </div>
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-primary p-[11px_16px]">
            Successfully migrated {keysMigrated} {keysMigrated === 1 ? 'key' : 'keys'} to{' '}
            <span className="font-semibold">{targetGroup?.name}</span>. They have been queued for remediation.
          </span>
        </div>
      </>
    )
  } else {
    content = (
      <div className="relative flex h-[64px] mt-[-5px] gradient-border-red">
        <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px]">
          <span className="text-[20px] text-text-secondary">Oops! Something went wrong.</span>
        </div>
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
            <span className="text-sm font-semibold">Migrate Keys</span>
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
              <Button variant="outline" onClick={onClose} disabled={status === 'loading'}>
                Cancel
              </Button>
              <Button onClick={migrateKeys} disabled={status === 'loading' || !canMigrate}>
                {status === 'loading' ? <LoaderIcon className="animate-spin" /> : 'Migrate Keys'}
              </Button>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="flex-1" />
              <Button onClick={onClose}>Close</Button>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="flex-1" />
              <Button disabled={!canMigrate} onClick={migrateKeys}>
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}