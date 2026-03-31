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
  getApplicationSettings,
  RetrieveBlockchainSettings,
  UpsertApplicationSettings,
  ValidateIndexerUrl,
  ValidateRpcEndpoint,
} from '@/actions/ApplicationSettings'
import { LoaderIcon } from '@igniter/ui/assets'
import { ChainId } from '@igniter/db/middleman/enums'

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
  fee: z.coerce
    .number()
    .int('Service fee must be a whole number')
    .min(0, 'Service fee must be greater than or equal to 0')
    .max(100),
  delegatorRewardsAddress: z.string().refine(
    (value) => value.toLowerCase().startsWith('pokt') && value.length === 43,
    (val) => ({ message: `${val} is not a valid address` })
  ),
  pocketApiUrl: z.string().optional().refine(
    (v) => !v || /^https?:\/\/.+/.test(v),
    'Please enter a valid URL'
  ),
  pocketRpcUrl: z.string().optional().refine(
    (v) => !v || /^https?:\/\/.+/.test(v),
    'Please enter a valid URL'
  ),
  indexerApiUrl: z.string().optional().refine(
    (v) => !v || /^https?:\/\/.+/.test(v),
    'Please enter a valid URL'
  ),
  chainId: z.string().optional(),
  minimumStake: z.number().optional(),
  appIdentity: z.string().optional(),
  updatedAtHeight: z.string().optional(),
})

type FormValues = z.infer<typeof FormSchema>;

export default function SettingsForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isValidatingRpc, setIsValidatingRpc] = useState(false)
  const [isValidatingIndexer, setIsValidatingIndexer] = useState(false)
  const [isValidatingRpcEndpoint, setIsValidatingRpcEndpoint] = useState(false)
  const [rpcWarning, setRpcWarning] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const rpcDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const rpcEndpointDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const indexerDebounceRef = useRef<NodeJS.Timeout | null>(null)

  const {
    data: settings,
    refetch: refetchSettings,
    isLoading: isLoadingSettings,
    isError,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: getApplicationSettings,
    refetchInterval: 60000,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: settings?.name || '',
      supportEmail: settings?.supportEmail || '',
      ownerEmail: settings?.ownerEmail || '',
      fee: (settings?.fee) || 0,
      delegatorRewardsAddress: settings?.delegatorRewardsAddress || '',
      pocketApiUrl: settings?.pocketApiUrl || '',
      pocketRpcUrl: settings?.pocketRpcUrl || '',
      indexerApiUrl: settings?.indexerApiUrl || '',
      chainId: settings?.chainId || '',
      minimumStake: settings?.minimumStake,
      appIdentity: settings?.appIdentity || '',
      updatedAtHeight: settings?.updatedAtHeight || '',
    },
    values: settings ? {
      name: settings.name || '',
      supportEmail: settings.supportEmail || '',
      ownerEmail: settings.ownerEmail || '',
      fee: (settings.fee) || 0,
      delegatorRewardsAddress: settings.delegatorRewardsAddress || '',
      pocketApiUrl: settings.pocketApiUrl || '',
      pocketRpcUrl: settings.pocketRpcUrl || '',
      indexerApiUrl: settings.indexerApiUrl || '',
      chainId: settings.chainId || '',
      minimumStake: settings.minimumStake,
      appIdentity: settings.appIdentity || '',
      updatedAtHeight: settings.updatedAtHeight || '',
    } : undefined,
  })

  const allValues = form.watch()
  const pocketApiUrl = allValues.pocketApiUrl
  const pocketRpcUrl = allValues.pocketRpcUrl
  const indexerApiUrl = allValues.indexerApiUrl
  const isDirty = JSON.stringify(allValues) !== JSON.stringify(form.formState.defaultValues)

  const validateRpcUrl = useCallback(async (url: string) => {
    if (!url) return
    try {
      setIsValidatingRpc(true)
      form.clearErrors('pocketApiUrl')
      setRpcWarning(null)

      const response = await RetrieveBlockchainSettings(url, allValues.updatedAtHeight || null)

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
    } catch {
      form.setError('pocketApiUrl', { type: 'manual', message: 'Could not reach the API endpoint. Check the URL and ensure the node is accessible.' })
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

  const validateRpcEndpoint = useCallback(async (url: string) => {
    if (!url) return
    try {
      setIsValidatingRpcEndpoint(true)
      form.clearErrors('pocketRpcUrl')
      const result = await ValidateRpcEndpoint(url)
      if (!result.success) {
        form.setError('pocketRpcUrl', { type: 'manual', message: result.error || 'Invalid RPC endpoint' })
      } else if (result.network && settings?.chainId && result.network !== settings.chainId) {
        form.setError('pocketRpcUrl', { type: 'manual', message: `RPC is on network "${result.network}" but this app is configured for "${settings.chainId}". Both must point to the same chain.` })
      }
    } catch {
      form.setError('pocketRpcUrl', { type: 'manual', message: 'Could not reach the RPC endpoint.' })
    } finally {
      setIsValidatingRpcEndpoint(false)
    }
  }, [])

  useEffect(() => {
    if (!indexerApiUrl || indexerApiUrl === settings?.indexerApiUrl) return
    form.clearErrors('indexerApiUrl')
    if (indexerDebounceRef.current) clearTimeout(indexerDebounceRef.current)
    indexerDebounceRef.current = setTimeout(() => validateIndexerUrl(indexerApiUrl), 1000)
    return () => { if (indexerDebounceRef.current) clearTimeout(indexerDebounceRef.current) }
  }, [indexerApiUrl])

  useEffect(() => {
    if (!pocketRpcUrl || pocketRpcUrl === settings?.pocketRpcUrl) return
    form.clearErrors('pocketRpcUrl')
    if (rpcEndpointDebounceRef.current) clearTimeout(rpcEndpointDebounceRef.current)
    rpcEndpointDebounceRef.current = setTimeout(() => validateRpcEndpoint(pocketRpcUrl), 1000)
    return () => { if (rpcEndpointDebounceRef.current) clearTimeout(rpcEndpointDebounceRef.current) }
  }, [pocketRpcUrl])

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const { chainId, ...rest } = values
      await UpsertApplicationSettings({
        ...rest,
        chainId: chainId as ChainId,
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
        </div>

        <div className="h-px bg-border-primary" />

        {/* Gateway */}
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Gateway</span>

          <FormField control={form.control} name="fee" render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel className="text-sm shrink-0 w-28">Service Fee</FormLabel>
              <div className="flex-1">
                <FormControl>
                  <Input {...field} value={field.value ?? 0} min={0} max={100} type="number" className="h-9 text-sm" />
                </FormControl>
                <FormMessage className="mt-1" />
              </div>
              <span className="text-sm text-text-tertiary shrink-0">%</span>
            </FormItem>
          )} />

          <FormField control={form.control} name="delegatorRewardsAddress" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-4">
              <FormLabel className="text-sm shrink-0 w-28 mt-2.5">Rewards Address</FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} value={field.value ?? ''} className="h-9 text-sm font-mono" placeholder="pokt1..." /></FormControl>
                <p className="text-[11px] text-text-tertiary mt-1 px-1">Address where delegator rewards are sent.</p>
                <FormMessage className="mt-1" />
              </div>
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
                <FormControl><Input {...field} value={field.value ?? ''} className="h-9 text-sm" placeholder="https://your-node-api.example.com" /></FormControl>
                <p className="text-[11px] text-text-tertiary mt-1 px-1">Cosmos SDK REST API endpoint (port 1317). Used for querying chain state and simulating transactions.</p>
                <FormMessage className="mt-1" />
                {rpcWarning && <p className="text-[11px] text-yellow-500 mt-1">{rpcWarning}</p>}
              </div>
            </FormItem>
          )} />

          <FormField control={form.control} name="pocketRpcUrl" render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-4">
              <FormLabel className="text-sm shrink-0 w-28 mt-2.5">
                Pocket RPC URL
                {isValidatingRpcEndpoint && <LoaderIcon className="inline-block animate-spin ml-1 h-3 w-3" />}
              </FormLabel>
              <div className="flex-1">
                <FormControl><Input {...field} value={field.value ?? ''} className="h-9 text-sm" placeholder="https://your-node-rpc.example.com" /></FormControl>
                <p className="text-[11px] text-text-tertiary mt-1 px-1">CometBFT RPC endpoint (port 26657). Used for broadcasting and verifying transactions.</p>
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
                <FormControl><Input {...field} value={field.value ?? ''} className="h-9 text-sm" placeholder="https://api.poktscan.com" /></FormControl>
                <p className="text-[11px] text-text-tertiary mt-1 px-1">GraphQL API URL of the POKTscan indexer. Must match the same network as your node.</p>
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
          <Button type="submit" disabled={isSubmitting || !isDirty || isValidatingRpc || isValidatingRpcEndpoint || isValidatingIndexer || !!form.formState.errors.pocketApiUrl || !!form.formState.errors.pocketRpcUrl || !!form.formState.errors.indexerApiUrl}>
            {isSubmitting ? <LoaderIcon className="animate-spin mr-2 h-4 w-4" /> : null}
            Save Changes
          </Button>
        </div>

      </form>
    </Form>
  )
}
