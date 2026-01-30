'use client'

import React, { useState } from 'react'
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
import { Textarea } from '@igniter/ui/components/textarea'
import { useQuery } from '@tanstack/react-query'
import {
  GetApplicationSettings,
  RetrieveBlockchainSettings,
  UpsertApplicationSettings,
  ValidateBlockchainRPC,
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
    if (!value) {
      return true;
    }

    const lines = value.trim().split(/[\n,\s]+/);
    const addresses = lines.map((line) => line.trim()).filter(isPoktBech32Address);

    return addresses.length !== 0
  }, 'There are no addresses in the list.')
    .refine((value) => {
      if (!value) {
        return true;
      }

      const lines = value.trim().split(/[\n,\s]+/);
      const addresses = lines.map((line) => line.trim()).filter(isPoktBech32Address);

      return addresses.length === lines.length;
    }, 'There are invalid addresses in the list.'),
  rpcUrl: z.string().optional().superRefine(async (url, ctx) => {
    if (!url) {
      return // Skip validation if empty
    }

    try {
      const response = await ValidateBlockchainRPC(url)

      if (!response.success && response.errors && response.errors.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: response.errors[0],
        })
        return false
      }
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Failed to validate RPC URL',
      })
      return false
    }
  }),
  indexerApiUrl: z.string().optional().superRefine(async (url, ctx) => {
    if (!url) {
      return // Skip validation if empty
    }

    try {
      const response = await ValidateIndexerUrl(url)

      if (!response.success && response.errors && response.errors.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: response.errors[0],
        })
        return false
      }
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Failed to validate Indexer API URL',
      })
      return false
    }
  }),
  chainId: z.string().optional(),
  minimumStake: z.number().optional(),
  appIdentity: z.string().optional(),
  updatedAtHeight: z.string().optional(),
})

type FormValues = z.infer<typeof FormSchema>;

export default function SettingsForm() {
  const [isReloadingBlockchainSettings, setIsReloadingBlockchainSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const reloadBlockchainSettings = async () => {
    try {
      setIsReloadingBlockchainSettings(true)
      const url = form.getValues().rpcUrl
      const updatedAtHeight = form.getValues().updatedAtHeight
      if (!url || !updatedAtHeight) {
        throw new Error('Invalid RPC URL or Updated At Height')
      }

      const response = await RetrieveBlockchainSettings(url, updatedAtHeight)

      if (!response.success) {
        throw new Error('Failed to retrieve blockchain settings')
      }

      form.setValue('minimumStake', response.minStake)
      form.setValue('updatedAtHeight', response.height)
      await form.handleSubmit(onSubmit)()
    } catch (error) {
      // TODO: show a transient error
      console.error('Failed to reload blockchain settings:', error)
    } finally {
      setIsReloadingBlockchainSettings(false)
    }
  }

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const { chainId, rewardAddresses, ...settings } = values
      await UpsertApplicationSettings({
        ...settings,
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
                            className="min-h-[140px] max-h-[260px] font-mono !text-[12px] border-[color:--divider] bg-[color:--background] placeholder:text-[color:--secondary]"
                          />
                        </FormControl>
                        <FormMessage className={cn(!error?.message ? 'text-xs! text-[color:var(--color-white-3)]' : null)}>
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

                  <div className="p-4 rounded-md bg-[var(--color-slate-2)]">
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="rpcUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[var(--color-white-2)]">RPC URL</FormLabel>
                            <FormControl>
                              <Input {...field} className="bg-[var(--color-slate-3)]"/>
                            </FormControl>
                            <FormMessage/>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="mt-4 space-y-3 flex justify-between">
                      <span className="font-medium text-[var(--color-white-3)]">Blockchain Derived Settings</span>
                      {!isReloadingBlockchainSettings && (
                        <Button
                          className={'bg-slate-2'}
                          variant="outline"
                          type={'button'}
                          disabled={isSubmitting || form.formState.dirtyFields.rpcUrl}
                          onClick={reloadBlockchainSettings}
                        >
                          Reload
                        </Button>
                      )}
                      {isReloadingBlockchainSettings && (
                        <LoaderIcon className="animate-spin"/>
                      )}
                    </div>
                    <div className="mt-2 space-y-3">
                      <FormField
                        control={form.control}
                        name="chainId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[var(--color-white-2)]">Chain ID</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-[var(--color-slate-3)] pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="minimumStake"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[var(--color-white-2)]">Minimum Stake</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-[var(--color-slate-3)] pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="appIdentity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[var(--color-white-2)]">App Identity</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-[var(--color-slate-3)] pointer-events-none"/>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="updatedAtHeight"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[var(--color-white-2)]">Updated At Height</FormLabel>
                            <FormControl>
                              <Input {...field} readOnly className="bg-[var(--color-slate-3)] pointer-events-none"/>
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
                        <FormLabel>Indexer API URL</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
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
