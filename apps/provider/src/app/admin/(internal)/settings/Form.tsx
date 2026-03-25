'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@igniter/ui/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@igniter/ui/components/form'
import { Input } from '@igniter/ui/components/input'
import { Textarea } from '@igniter/ui/components/textarea'
import { useQuery } from '@tanstack/react-query'
import {
  GetApplicationSettings,
  RetrieveBlockchainSettings,
  UpsertApplicationSettings,
  ValidateIndexerUrl,
} from '@/actions/ApplicationSettings'
import { LoaderIcon } from '@igniter/ui/assets'
import { ChainId } from '@igniter/db/provider/enums'
import { isPoktBech32Address } from '@/lib/crypto'
import { cn } from '@igniter/ui/lib/utils'

const FormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  supportEmail: z.string().email('Invalid email format').optional(),
  rewardAddresses: z.string().refine((value) => {
    if (!value) return true
    const lines = value.trim().split(/[\n,\s]+/)
    const addresses = lines.map((line) => line.trim()).filter(isPoktBech32Address)
    return addresses.length !== 0
  }, 'There are no addresses in the list.')
    .refine((value) => {
      if (!value) return true
      const lines = value.trim().split(/[\n,\s]+/)
      const addresses = lines.map((line) => line.trim()).filter(isPoktBech32Address)
      return addresses.length === lines.length
    }, 'There are invalid addresses in the list.'),
  rpcUrl: z.string().url('Please enter a valid URL').optional(),
  indexerApiUrl: z.string().url('Please enter a valid URL').optional(),
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
  const [rpcWarning, setRpcWarning] = useState<string | null>(null)
  const [indexerWarning, setIndexerWarning] = useState<string | null>(null)
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
      rewardAddresses: settings?.rewardAddresses?.join('\n') || '',
      rpcUrl: settings?.rpcUrl || '',
      indexerApiUrl: settings?.indexerApiUrl || '',
      chainId: settings?.chainId || '',
      minimumStake: settings?.minimumStake,
      appIdentity: settings?.appIdentity || '',
      updatedAtHeight: settings?.updatedAtHeight || '',
    },
    values: settings ? {
      name: settings.name || '',
      supportEmail: settings.supportEmail || '',
      rewardAddresses: settings.rewardAddresses?.join('\n') || '',
      rpcUrl: settings.rpcUrl || '',
      indexerApiUrl: settings.indexerApiUrl || '',
      chainId: settings.chainId || '',
      minimumStake: settings.minimumStake,
      appIdentity: settings.appIdentity || '',
      updatedAtHeight: settings.updatedAtHeight || '',
    } : undefined,
  })

  const isDirty = form.formState.isDirty
  const rpcUrl = form.watch('rpcUrl')
  const indexerApiUrl = form.watch('indexerApiUrl')

  const validateRpcUrl = useCallback(async (url: string) => {
    if (!url) return
    try {
      setIsValidatingRpc(true)
      form.clearErrors('rpcUrl')
      setRpcWarning(null)

      const response = await RetrieveBlockchainSettings(url, null)

      if (!response.success && response.errors) {
        form.setError('rpcUrl', { type: 'manual', message: response.errors[0] })
        return
      }

      if (response.network && response.network !== settings?.chainId) {
        form.setError('rpcUrl', {
          type: 'manual',
          message: `This node is on network "${response.network}" but the app is configured for "${settings?.chainId}". Changing the network is not supported.`,
        })
        return
      }

      if (response.height && settings?.updatedAtHeight) {
        const newHeight = parseInt(response.height, 10)
        const storedHeight = parseInt(settings.updatedAtHeight, 10)
        if (newHeight < storedHeight) {
          setRpcWarning(`This node's height (${newHeight}) is behind the stored height (${storedHeight}). The node may be syncing.`)
        }
      }

      if (response.minStake) {
        form.setValue('minimumStake', response.minStake, { shouldDirty: true })
      }
      if (response.height) {
        form.setValue('updatedAtHeight', response.height, { shouldDirty: true })
      }
    } catch (err) {
      form.setError('rpcUrl', { type: 'manual', message: (err as Error).message })
    } finally {
      setIsValidatingRpc(false)
    }
  }, [settings?.chainId, settings?.updatedAtHeight])

  const validateIndexerUrl = useCallback(async (url: string) => {
    if (!url) return
    try {
      setIsValidatingIndexer(true)
      form.clearErrors('indexerApiUrl')
      setIndexerWarning(null)

      const response = await ValidateIndexerUrl(url)

      if (!response.success && response.errors && response.errors.length > 0) {
        form.setError('indexerApiUrl', { type: 'manual', message: response.errors[0] })
      }
    } catch (err) {
      form.setError('indexerApiUrl', { type: 'manual', message: 'Failed to validate Indexer API URL' })
    } finally {
      setIsValidatingIndexer(false)
    }
  }, [])

  useEffect(() => {
    if (!rpcUrl || rpcUrl === settings?.rpcUrl) return
    form.clearErrors('rpcUrl')
    setRpcWarning(null)

    if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current)
    rpcDebounceRef.current = setTimeout(() => validateRpcUrl(rpcUrl), 1000)

    return () => { if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current) }
  }, [rpcUrl])

  useEffect(() => {
    if (!indexerApiUrl || indexerApiUrl === settings?.indexerApiUrl) return
    form.clearErrors('indexerApiUrl')
    setIndexerWarning(null)

    if (indexerDebounceRef.current) clearTimeout(indexerDebounceRef.current)
    indexerDebounceRef.current = setTimeout(() => validateIndexerUrl(indexerApiUrl), 1000)

    return () => { if (indexerDebounceRef.current) clearTimeout(indexerDebounceRef.current) }
  }, [indexerApiUrl])

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const { chainId, rewardAddresses, ...rest } = values
      await UpsertApplicationSettings({
        ...rest,
        chainId: chainId as ChainId,
        rewardAddresses: rewardAddresses?.split(/[\n,\s]+/)?.filter(isPoktBech32Address) || [],
      }, true)
      await refetchSettings()
      form.reset(values)
    } catch (error) {
      console.error('Failed to update settings:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-10 overflow-auto !max-h-[calc(100dvh-73px)]">
      <div className="mx-30 py-10">
        <div className={'flex flex-row items-center gap-4'}>
          <h1>Settings</h1>
        </div>

        <div className="container mx-auto !overflow-auto">
          {isLoadingSettings || !settings ? (
            <div className="flex justify-center items-center h-fit">
              <LoaderIcon className="animate-spin"/>
            </div>
          ) : isError ? (
            <div className="flex justify-center items-center h-[200px] flex-col">
              <p className={'!text-[16px] font-medium'}>
                There was a problem loading the settings.
              </p>
              <Button
                className="mt-4"
                onClick={() => refetchSettings()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="flex flex-col gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage/>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="supportEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Support Email</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage/>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="rewardAddresses"
                    render={({ field, fieldState: { error } }) => (
                      <FormItem>
                        <FormLabel>Reward Addresses</FormLabel>
                        <FormControl>
                          <Textarea
                            id="rewardAddresses"
                            placeholder={`Enter one or more addresses (separated by new lines, commas, or spaces):

pokt1abc123def456ghi789jkl012mno345pqr678stu
pokt1xyz789abc123def456ghi789jkl012mno345pqr
pokt1def456ghi789jkl012mno345pqr678stu901vwx`}
                            {...field}
                            className="min-h-[140px] max-h-[260px] font-mono !text-[12px] border-border-primary bg-bg-root placeholder:text-text-tertiary"
                          />
                        </FormControl>
                        <FormMessage className={cn(!error?.message ? 'text-xs! text-text-secondary' : null)}>
                          {error?.message ? error.message : (
                            <>
                              Used by Delegators to fetch your rewards. These must match the revenue-share address(es) you provided to suppliers to receive rewards in the addresses group.
                              <br/>
                              The Delegators are going to validate that the domains staked match the domains you are going to configure. If it does not match, your rewards are not going to be shown to the users that want to stake in the Delegators.
                            </>
                          )}
                        </FormMessage>
                      </FormItem>
                    )}
                  />

                  <div className="p-4 rounded-md bg-bg-elevated">
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="rpcUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-text-secondary">
                              Node API URL
                              {isValidatingRpc && <LoaderIcon className="inline-block animate-spin ml-2 h-3 w-3" />}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                className="bg-bg-input"
                                placeholder="https://your-shannon-node-api.example.com"
                              />
                            </FormControl>
                            <FormMessage/>
                            {rpcWarning && (
                              <p className="text-sm text-yellow-500">{rpcWarning}</p>
                            )}
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="mt-4 space-y-3">
                      <span className="font-medium text-text-secondary">Blockchain Derived Settings</span>
                    </div>
                    <div className="mt-2 space-y-3">
                      <FormField
                        control={form.control}
                        name="chainId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-text-secondary">Chain ID</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-bg-input pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="minimumStake"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-text-secondary">Minimum Stake</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-bg-input pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="appIdentity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-text-secondary">App Identity</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-bg-input pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="updatedAtHeight"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-text-secondary">Updated At Height</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-bg-input pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  <FormField
                    control={form.control}
                    name="indexerApiUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Indexer API URL
                          {isValidatingIndexer && <LoaderIcon className="inline-block animate-spin ml-2 h-3 w-3" />}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="https://api.poktscan.com"
                          />
                        </FormControl>
                        <FormDescription>
                          The GraphQL API URL of the POKTscan indexer. Must match the same network as your node.
                        </FormDescription>
                        <FormMessage/>
                      </FormItem>
                    )}
                  />
                </div>

                <Button type="submit" disabled={isSubmitting || !isDirty}>
                  {isSubmitting ? <LoaderIcon className="animate-spin mr-2"/> : null}
                  Save Changes
                </Button>
              </form>
            </Form>
          )}
        </div>
      </div>
    </div>
  )
}
