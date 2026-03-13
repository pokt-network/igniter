'use client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@igniter/ui/components/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@igniter/ui/components/tooltip'
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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  RetrieveBlockchainSettings,
  RetrieveIndexerNetwork,
  UpsertApplicationSettings,
} from '@/actions/ApplicationSettings'
import type { ApplicationSettings } from '@igniter/db/provider/schema'
import { ChainId } from '@igniter/db/provider/enums'

interface FormProps {
  defaultValues: Partial<ApplicationSettings>;
  goNext: () => void;
}

const RpcUrlSchema = z.string().url('Please enter a valid URL').min(1, 'URL is required')

export const FormSchema = z.object({
  chainId: z.nativeEnum(ChainId),
  rpcUrl: RpcUrlSchema,
  indexerApiUrl: RpcUrlSchema,
  appIdentity: z.string().min(1, 'App Identity is Required'),
  updatedAtHeight: z.string().nullable(),
  minimumStake: z.coerce.number(),
}).superRefine(async (values, ctx) => {
  if (!values.indexerApiUrl) {
    return // Skip validation if empty
  }

  try {
    const indexerNetwork = await RetrieveIndexerNetwork(values.indexerApiUrl)

    if (indexerNetwork !== values.chainId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Indexer network (${indexerNetwork}) does not match chain ID (${values.chainId})`,
        path: ['indexerApiUrl'],
      })
      return false
    }

  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed to validate Indexer API URL',
      path: ['indexerApiUrl'],
    })
    return false
  }
})

type FormValues = z.infer<typeof FormSchema>;

const FormComponent: React.FC<FormProps> = ({ defaultValues, goNext }) => {
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingBlockchainParams, setIsLoadingBlockchainParams] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      rpcUrl: defaultValues?.rpcUrl || '',
      indexerApiUrl: defaultValues?.indexerApiUrl || '',
      minimumStake: defaultValues?.minimumStake,
      chainId: defaultValues?.chainId,
      updatedAtHeight: defaultValues?.updatedAtHeight ?? null,
      appIdentity: defaultValues?.appIdentity || '',
    },
  })

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const { isValidating, isSubmitting } = form.formState
  const [rpcUrl, chainId] = form.watch([
    'rpcUrl',
    'chainId',
  ])

  const debouncedRetrieveParams = useCallback(() => {
    // Clear the error immediately so the user gets instant feedback when they start fixing the URL
    form.clearErrors('rpcUrl')

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      if (rpcUrl && rpcUrl.trim() !== '') {
        retrieveBlockchainParams()
      }
    }, 1000)
  }, [rpcUrl])

  useEffect(() => {
    debouncedRetrieveParams()

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [rpcUrl, debouncedRetrieveParams])

  const isUpdate = useMemo(() => defaultValues?.id !== 0, [defaultValues])
  const formRef = useRef<HTMLFormElement>(null)

  const handleGoNext = () => {
    formRef.current?.requestSubmit()
  }

  const retrieveBlockchainParams = async () => {
    const url = form.getValues().rpcUrl
    const validatedUrl = RpcUrlSchema.safeParse(url)

    if (!validatedUrl.success) {
      form.setError('rpcUrl', {
        type: 'manual',
        message: 'Please enter a valid URL (e.g., https://your-node.example.com:26657)',
      })
      return
    }

    // Clear any previous error before fetching — a valid URL format is a good sign
    form.clearErrors('rpcUrl')

    try {
      setIsLoadingBlockchainParams(true)

      const updatedAtHeight = form.getValues().updatedAtHeight

      const response = await RetrieveBlockchainSettings(validatedUrl.data, updatedAtHeight)

      if (!response.success && response.errors) {
        const [error] = response.errors
        form.setError('rpcUrl', {
          type: 'manual',
          message: error,
        })
        return
      } else if (response.network && response.height && response.minStake) {
        form.clearErrors('rpcUrl')
        form.setValue('chainId', response.network as ChainId)
        form.setValue('minimumStake', response.minStake)
        form.setValue('updatedAtHeight', response.height)
      }
    } catch (err) {
      const { message } = err as Error
      console.error('Failed to fetch blockchain params', err)
      form.setError('rpcUrl', {
        type: 'manual',
        message,
      })
    } finally {
      setIsLoadingBlockchainParams(false)
    }
  }

  const submit = async (values: FormValues) => {
    setIsLoading(true)
    try {
      await UpsertApplicationSettings(values, isUpdate)
      goNext()
    } catch (error) {
      console.error('Something failed while updating the application settings', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col justify-between gap-4">
      <Form {...form}>
        <form ref={formRef} onSubmit={form.handleSubmit(submit)} className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="appIdentity"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App Identity</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={true}/>
                  </FormControl>
                  <FormMessage/>
                  <FormDescription>
                    Your App Identity is the unique public identifier derived from your private key.
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              name="rpcUrl"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Node API URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={isLoadingBlockchainParams}
                      placeholder="https://your-shannon-node.example.com:26657"
                    />
                  </FormControl>
                  <FormDescription>
                    The API endpoint of your full node — <strong>not</strong> a public RPC or gateway URL.
                    This is used to auto-detect the network and minimum stake. The network (chain ID) cannot be changed after setup.
                    Example: <code>https://shannon-node.mycompany.com:26657</code>
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="chainId"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Network</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={true}/>
                  </FormControl>
                  <FormDescription>
                    Auto-detected from your node. Cannot be changed after setup.
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />
            <FormField
              name="minimumStake"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Network Minimum Stake</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={true}/>
                  </FormControl>
                  <FormDescription>
                    Auto-detected from your node. Suppliers must stake at least this amount (in uPOKT).
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="indexerApiUrl"
              control={form.control}
              render={({ field }) => {
                const isDisabled = !chainId || !rpcUrl || isLoadingBlockchainParams;
                return (
                <FormItem>
                  <FormLabel>Indexer API URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={isDisabled}
                      placeholder="https://shannon-indexer.example.com/graphql"
                    />
                  </FormControl>
                  <FormDescription>
                    The GraphQL API URL of the POKTscan indexer for your network. Used to fetch supplier rewards and on-chain data.
                    Must match the same network as your node.
                    <br/>
                    For example:
                    <br/>
                    POKTscan Mainnet:{' '}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <code
                            className="cursor-pointer underline decoration-dotted hover:text-foreground transition-colors"
                            onClick={isDisabled ? undefined : () => field.onChange('https://api.poktscan.com')}
                          >
                            https://api.poktscan.com
                          </code>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isDisabled ? 'Fill in the Node API URL first' : 'Click to use this URL'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <br/>
                    POKTscan Beta:{' '}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <code
                            className="cursor-pointer underline decoration-dotted hover:text-foreground transition-colors"
                            onClick={isDisabled ? undefined : () => field.onChange('https://beta-api.poktscan.com')}
                          >
                            https://beta-api.poktscan.com
                          </code>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isDisabled ? 'Fill in the Node API URL first' : 'Click to use this URL'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
                );
              }}
            />
          </div>
        </form>
      </Form>

      <div className="flex justify-end">
        <Button type="button" onClick={handleGoNext} disabled={isLoading || isValidating || isSubmitting}>
          {isLoading ? 'Loading...' : 'Next'}
        </Button>
      </div>
    </div>
  )
}

export default FormComponent
