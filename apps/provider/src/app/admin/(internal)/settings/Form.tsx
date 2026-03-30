'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@igniter/ui/components/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@igniter/ui/components/form'
import { Input } from '@igniter/ui/components/input'
import { useQuery } from '@tanstack/react-query'
import {
  GetApplicationSettings,
  RetrieveBlockchainSettings,
  UpsertApplicationSettings,
  ValidateIndexerUrl,
} from '@/actions/ApplicationSettings'
import { LoaderIcon } from '@igniter/ui/assets'
import { Trash2Icon } from 'lucide-react'
import { ChainId } from '@igniter/db/provider/enums'
import { isPoktBech32Address } from '@/lib/crypto'
import clsx from 'clsx'

const FormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  supportEmail: z.string().optional().refine(
    (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'Invalid email format'
  ),
  ownerEmail: z.string().optional().refine(
    (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'Invalid email format'
  ),
  rewardAddresses: z.array(z.string()).default([]),
  pocketApiUrl: z.string().url('Please enter a valid URL').optional(),
  pocketRpcUrl: z.string().url('Please enter a valid URL').optional(),
  indexerApiUrl: z.string().optional().refine(
    (v) => !v || /^https?:\/\/.+/.test(v),
    'Please enter a valid URL'
  ),
  initialOperationalFunds: z.coerce.number().min(0, 'Must be >= 0').optional(),
  minimumOperationalFunds: z.coerce.number().min(0, 'Must be >= 0').optional(),
  chainId: z.string().optional(),
  minimumStake: z.number().optional(),
  appIdentity: z.string().optional(),
  ownerIdentity: z.string().optional(),
  updatedAtHeight: z.string().optional(),
})

type FormValues = z.infer<typeof FormSchema>;

export default function SettingsForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isValidatingRpc, setIsValidatingRpc] = useState(false)
  const [isValidatingIndexer, setIsValidatingIndexer] = useState(false)
  const [rpcWarning, setRpcWarning] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const rpcDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const indexerDebounceRef = useRef<NodeJS.Timeout | null>(null)

  const {
    data: settings,
    refetch: refetchSettings,
    isLoading: isLoadingSettings,
    isError,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: GetApplicationSettings,
    refetchInterval: 60000,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: settings?.name || '',
      supportEmail: settings?.supportEmail || '',
      ownerEmail: settings?.ownerEmail || '',
      rewardAddresses: settings?.rewardAddresses || [],
      pocketApiUrl: settings?.pocketApiUrl || '',
      pocketRpcUrl: settings?.pocketRpcUrl || '',
      indexerApiUrl: settings?.indexerApiUrl || '',
      initialOperationalFunds: settings?.initialOperationalFunds ?? 5,
      minimumOperationalFunds: settings?.minimumOperationalFunds ?? 2,
      chainId: settings?.chainId || '',
      minimumStake: settings?.minimumStake ?? 0,
      appIdentity: settings?.appIdentity || '',
      ownerIdentity: settings?.ownerIdentity || '',
      updatedAtHeight: settings?.updatedAtHeight || '',
    },
    values: settings ? {
      name: settings.name || '',
      supportEmail: settings.supportEmail || '',
      ownerEmail: settings.ownerEmail || '',
      rewardAddresses: settings.rewardAddresses || [],
      pocketApiUrl: settings.pocketApiUrl || '',
      pocketRpcUrl: settings.pocketRpcUrl || '',
      indexerApiUrl: settings.indexerApiUrl || '',
      initialOperationalFunds: settings.initialOperationalFunds ?? 5,
      minimumOperationalFunds: settings.minimumOperationalFunds ?? 2,
      chainId: settings.chainId || '',
      minimumStake: settings.minimumStake,
      appIdentity: settings.appIdentity || '',
      ownerIdentity: settings.ownerIdentity || '',
      updatedAtHeight: settings.updatedAtHeight || '',
    } : undefined,
  })

  const allValues = form.watch()
  const pocketApiUrl = allValues.pocketApiUrl
  const indexerApiUrl = allValues.indexerApiUrl
  const rewardAddresses = allValues.rewardAddresses ?? []
  const isDirty = JSON.stringify(allValues) !== JSON.stringify(form.formState.defaultValues)

  // Live validation for reward addresses
  const addressErrors = React.useMemo(() => {
    const errors: Record<number, string> = {}
    const seen: string[] = []
    rewardAddresses.forEach((addr, i) => {
      if (!addr || !addr.trim()) {
        errors[i] = 'Address cannot be empty'
      } else if (!isPoktBech32Address(addr)) {
        errors[i] = 'Invalid POKT address'
      } else if (seen.includes(addr)) {
        errors[i] = 'Duplicate address'
      }
      if (addr) seen.push(addr)
    })
    return errors
  }, [rewardAddresses])

  const hasAddressErrors = Object.keys(addressErrors).length > 0

  const validateRpcUrl = useCallback(async (url: string) => {
    if (!url) return
    try {
      setIsValidatingRpc(true)
      form.clearErrors('pocketApiUrl')
      setRpcWarning(null)

      const response = await RetrieveBlockchainSettings(url, null)

      if (!response.success && response.errors) {
        form.setError('pocketApiUrl', { type: 'manual', message: response.errors[0] })
        return
      }

      if (response.network && response.network !== settings?.chainId) {
        form.setError('pocketApiUrl', {
          type: 'manual',
          message: `This node is on network "${response.network}" but the app is configured for "${settings?.chainId}".`,
        })
        return
      }

      if (response.height && settings?.updatedAtHeight) {
        const newHeight = parseInt(response.height, 10)
        const storedHeight = parseInt(settings.updatedAtHeight, 10)
        if (newHeight < storedHeight) {
          setRpcWarning(`Node height (${newHeight}) is behind stored height (${storedHeight}). The node may be syncing.`)
        }
      }

      if (response.minStake) form.setValue('minimumStake', response.minStake, { shouldDirty: true })
      if (response.height) form.setValue('updatedAtHeight', response.height, { shouldDirty: true })
    } catch (err) {
      form.setError('pocketApiUrl', { type: 'manual', message: (err as Error).message })
    } finally {
      setIsValidatingRpc(false)
    }
  }, [settings?.chainId, settings?.updatedAtHeight])

  const validateIndexerUrl = useCallback(async (url: string) => {
    if (!url) return
    try {
      setIsValidatingIndexer(true)
      form.clearErrors('indexerApiUrl')

      const response = await ValidateIndexerUrl(url)

      if (!response.success && response.errors && response.errors.length > 0) {
        form.setError('indexerApiUrl', { type: 'manual', message: response.errors[0] })
      }
    } catch {
      form.setError('indexerApiUrl', { type: 'manual', message: 'Failed to validate Indexer API URL' })
    } finally {
      setIsValidatingIndexer(false)
    }
  }, [])

  useEffect(() => {
    if (!pocketApiUrl || pocketApiUrl === settings?.pocketApiUrl) return
    form.clearErrors('pocketApiUrl')
    setRpcWarning(null)
    if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current)
    rpcDebounceRef.current = setTimeout(() => validateRpcUrl(pocketApiUrl), 1000)
    return () => { if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current) }
  }, [pocketApiUrl])

  useEffect(() => {
    if (!indexerApiUrl || indexerApiUrl === settings?.indexerApiUrl) return
    form.clearErrors('indexerApiUrl')
    if (indexerDebounceRef.current) clearTimeout(indexerDebounceRef.current)
    indexerDebounceRef.current = setTimeout(() => validateIndexerUrl(indexerApiUrl), 1000)
    return () => { if (indexerDebounceRef.current) clearTimeout(indexerDebounceRef.current) }
  }, [indexerApiUrl])

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null)

    // Validate reward addresses
    if (hasAddressErrors) {
      setSubmitError('Please fix the reward address errors.')
      return
    }

    setIsSubmitting(true)
    try {
      const { chainId, rewardAddresses: addrs, ownerIdentity, ...rest } = values
      await UpsertApplicationSettings({
        ...rest,
        chainId: chainId as ChainId,
        rewardAddresses: (addrs ?? []).filter(isPoktBech32Address),
      }, true)
      await refetchSettings()
      form.reset(values)
    } catch (error) {
      console.error('Failed to update settings:', error)
      setSubmitError('Failed to save settings. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoadingSettings || !settings) {
    return (
      <div className="flex justify-center items-center h-[200px]">
        <LoaderIcon className="animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex justify-center items-center h-[200px] flex-col">
        <p className="text-sm font-medium">There was a problem loading the settings.</p>
        <Button className="mt-4" onClick={() => refetchSettings()}>Retry</Button>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">

        {/* General */}
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">General</span>

          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel className="text-sm shrink-0 w-28">Name</FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} className="h-9 text-sm" /></FormControl>
                <FormMessage className="mt-1" />
              </div>
            </FormItem>
          )} />

          <FormField control={form.control} name="supportEmail" render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel className="text-sm shrink-0 w-28">Support Email</FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} className="h-9 text-sm" placeholder="support@example.com" /></FormControl>
                <FormMessage className="mt-1" />
              </div>
            </FormItem>
          )} />

          <FormField control={form.control} name="ownerEmail" render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel className="text-sm shrink-0 w-28">Owner Email</FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} className="h-9 text-sm" placeholder="owner@example.com" /></FormControl>
                <FormMessage className="mt-1" />
              </div>
            </FormItem>
          )} />

          <div className="flex flex-row items-center gap-4">
            <span className="text-sm text-text-tertiary shrink-0 w-28">Owner</span>
            <span className="text-sm font-mono text-text-secondary truncate">{allValues.ownerIdentity || '-'}</span>
          </div>
        </div>

        <div className="h-px bg-border-primary" />

        {/* Reward Addresses */}
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Reward Addresses</span>
            <span
              className="text-xs cursor-pointer hover:underline"
              style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
              onClick={() => form.setValue('rewardAddresses', [...rewardAddresses, ''], { shouldDirty: true })}
            >
              Add Address
            </span>
          </div>
          <p className="text-[11px] text-text-tertiary -mt-1">
            Revenue-share addresses shown to delegators. Must match the addresses configured in your address groups.
          </p>

          {rewardAddresses.length === 0 && (
            <div className="text-text-tertiary text-[11px] italic">No reward addresses configured.</div>
          )}

          {rewardAddresses.map((addr, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  value={addr}
                  onChange={(e) => {
                    const cur = [...rewardAddresses]
                    cur[idx] = e.target.value
                    form.setValue('rewardAddresses', cur, { shouldDirty: true })
                  }}
                  placeholder="pokt1..."
                  className={clsx("h-8 text-xs font-mono flex-1", addressErrors[idx] && "border-red-500")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => {
                    const cur = [...rewardAddresses]
                    cur.splice(idx, 1)
                    form.setValue('rewardAddresses', cur, { shouldDirty: true })
                  }}
                >
                  <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
              {addressErrors[idx] && <p className="text-[10px] text-red-400">{addressErrors[idx]}</p>}
            </div>
          ))}
        </div>

        <div className="h-px bg-border-primary" />

        {/* Operational Funds */}
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Operational Funds</span>
          <p className="text-[11px] text-text-tertiary -mt-2">
            Controls how much uPOKT to fund each supplier for claim/proof transactions, and when to alert if funds are low.
          </p>

          <FormField control={form.control} name="initialOperationalFunds" render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel className="text-sm shrink-0 w-28">Initial Funds</FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} type="number" min={0} className="h-9 text-sm" placeholder="5" /></FormControl>
              </div>
              <span className="text-sm text-text-tertiary shrink-0">uPOKT</span>
            </FormItem>
          )} />

          <FormField control={form.control} name="minimumOperationalFunds" render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel className="text-sm shrink-0 w-28">Min Threshold</FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} type="number" min={0} className="h-9 text-sm" placeholder="2" /></FormControl>
              </div>
              <span className="text-sm text-text-tertiary shrink-0">uPOKT</span>
            </FormItem>
          )} />
        </div>

        <div className="h-px bg-border-primary" />

        {/* Blockchain */}
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Blockchain</span>

          <FormField control={form.control} name="pocketApiUrl" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-4">
              <FormLabel className="text-sm shrink-0 w-28 mt-2.5">
                Pocket API URL
                {isValidatingRpc && <LoaderIcon className="inline-block animate-spin ml-1 h-3 w-3" />}
              </FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} className="h-9 text-sm" placeholder="https://your-node-api.example.com" /></FormControl>
                <FormMessage className="mt-1" />
                {rpcWarning && <p className="text-[11px] text-yellow-500 mt-1">{rpcWarning}</p>}
              </div>
            </FormItem>
          )} />

          <FormField control={form.control} name="pocketRpcUrl" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-4">
              <FormLabel className="text-sm shrink-0 w-28 mt-2.5">
                Pocket RPC URL
              </FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} className="h-9 text-sm" placeholder="https://your-node-rpc.example.com" /></FormControl>
                <FormMessage className="mt-1" />
              </div>
            </FormItem>
          )} />

          {/* Read-only derived fields */}
          <div className="grid grid-cols-2 gap-4 px-0">
            <div className="flex flex-row items-center gap-4">
              <span className="text-sm text-text-tertiary shrink-0 w-28">Chain ID</span>
              <span className="text-sm font-mono text-text-secondary">{allValues.chainId || '-'}</span>
            </div>
            <div className="flex flex-row items-center gap-4">
              <span className="text-sm text-text-tertiary shrink-0 w-28">Min Stake</span>
              <span className="text-sm font-mono text-text-secondary">{allValues.minimumStake?.toLocaleString() ?? '-'} uPOKT</span>
            </div>
            <div className="flex flex-row items-center gap-4">
              <span className="text-sm text-text-tertiary shrink-0 w-28">App Identity</span>
              <span className="text-sm font-mono text-text-secondary truncate">{allValues.appIdentity || '-'}</span>
            </div>
            <div className="flex flex-row items-center gap-4">
              <span className="text-sm text-text-tertiary shrink-0 w-28">Height</span>
              <span className="text-sm font-mono text-text-secondary">{allValues.updatedAtHeight || '-'}</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-border-primary" />

        {/* Indexer */}
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Indexer</span>

          <FormField control={form.control} name="indexerApiUrl" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-4">
              <FormLabel className="text-sm shrink-0 w-28 mt-2.5">
                Indexer API URL
                {isValidatingIndexer && <LoaderIcon className="inline-block animate-spin ml-1 h-3 w-3" />}
              </FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} className="h-9 text-sm" placeholder="https://api.poktscan.com" /></FormControl>
                <p className="text-[11px] text-text-tertiary mt-1">GraphQL API URL of the POKTscan indexer. Must match the same network as your node.</p>
                <FormMessage className="mt-1" />
              </div>
            </FormItem>
          )} />
        </div>

        <div className="h-px bg-border-primary" />

        {/* Footer */}
        <div className="flex items-center gap-3">
          {submitError && <p className="text-xs text-red-400 flex-1">{submitError}</p>}
          <div className="flex-1" />
          <Button type="submit" disabled={isSubmitting || !isDirty || hasAddressErrors}>
            {isSubmitting ? <LoaderIcon className="animate-spin mr-2 h-4 w-4" /> : null}
            Save Changes
          </Button>
        </div>

      </form>
    </Form>
  )
}
