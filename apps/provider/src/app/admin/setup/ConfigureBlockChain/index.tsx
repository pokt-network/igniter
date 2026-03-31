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
  ValidateRpcEndpoint,
} from '@/actions/ApplicationSettings'
import type { ApplicationSettings } from '@igniter/db/provider/schema'
import { SetupHelpBar } from '@/components/SetupHelpBar'
import { ChainId } from '@igniter/db/provider/enums'

interface FormProps {
  defaultValues: Partial<ApplicationSettings>;
  goNext: () => void;
}

const RpcUrlSchema = z.string().url('Please enter a valid URL').min(1, 'URL is required')

export const FormSchema = z.object({
  chainId: z.nativeEnum(ChainId),
  pocketApiUrl: RpcUrlSchema,
  pocketRpcUrl: RpcUrlSchema,
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
      pocketApiUrl: defaultValues?.pocketApiUrl || '',
      pocketRpcUrl: defaultValues?.pocketRpcUrl || '',
      indexerApiUrl: defaultValues?.indexerApiUrl || '',
      minimumStake: defaultValues?.minimumStake,
      chainId: defaultValues?.chainId,
      updatedAtHeight: defaultValues?.updatedAtHeight ?? null,
      appIdentity: defaultValues?.appIdentity || '',
    },
  })

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const rpcDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const [isValidatingRpc, setIsValidatingRpc] = useState(false)

  const { isValidating, isSubmitting } = form.formState
  const [pocketApiUrl, pocketRpcUrl, chainId] = form.watch([
    'pocketApiUrl',
    'pocketRpcUrl',
    'chainId',
  ])

  const debouncedRetrieveParams = useCallback(() => {
    form.clearErrors('pocketApiUrl')
    form.clearErrors('indexerApiUrl')
    // Reset height so switching between networks (e.g., mainnet → beta) doesn't
    // fail the height regression check against the previous network's height.
    form.setValue('updatedAtHeight', null)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      if (pocketApiUrl && pocketApiUrl.trim() !== '') {
        retrieveBlockchainParams()
      }
    }, 1000)
  }, [pocketApiUrl])

  useEffect(() => {
    debouncedRetrieveParams()

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [pocketApiUrl, debouncedRetrieveParams])

  useEffect(() => {
    if (!pocketRpcUrl || pocketRpcUrl.trim() === '') return
    form.clearErrors('pocketRpcUrl')
    if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current)
    rpcDebounceRef.current = setTimeout(async () => {
      try {
        setIsValidatingRpc(true)
        const result = await ValidateRpcEndpoint(pocketRpcUrl)
        if (!result.success) {
          form.setError('pocketRpcUrl', { type: 'manual', message: result.error || 'Invalid RPC endpoint' })
        } else if (result.network && chainId && result.network !== chainId) {
          form.setError('pocketRpcUrl', { type: 'manual', message: `RPC is on network "${result.network}" but API detected "${chainId}". Both must point to the same chain.` })
        }
      } catch {
        form.setError('pocketRpcUrl', { type: 'manual', message: 'Could not reach the RPC endpoint.' })
      } finally {
        setIsValidatingRpc(false)
      }
    }, 1000)
    return () => { if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current) }
  }, [pocketRpcUrl])

  const isUpdate = useMemo(() => defaultValues?.id !== 0, [defaultValues])
  const formRef = useRef<HTMLFormElement>(null)

  const handleGoNext = () => {
    formRef.current?.requestSubmit()
  }

  const retrieveBlockchainParams = async () => {
    const url = form.getValues().pocketApiUrl
    const validatedUrl = RpcUrlSchema.safeParse(url)

    if (!validatedUrl.success) {
      form.setError('pocketApiUrl', {
        type: 'manual',
        message: 'Please enter a valid URL (e.g., https://your-node-api.example.com)',
      })
      return
    }

    // Clear any previous error before fetching — a valid URL format is a good sign
    form.clearErrors('pocketApiUrl')

    try {
      setIsLoadingBlockchainParams(true)

      const updatedAtHeight = form.getValues().updatedAtHeight

      const response = await RetrieveBlockchainSettings(validatedUrl.data, updatedAtHeight)

      if (!response.success && response.errors) {
        const [error] = response.errors
        form.setError('pocketApiUrl', {
          type: 'manual',
          message: error,
        })
        return
      } else if (response.network && response.height && response.minStake) {
        form.clearErrors('pocketApiUrl')
        form.setValue('chainId', response.network as ChainId)
        form.setValue('minimumStake', response.minStake)
        form.setValue('updatedAtHeight', response.height)
      }
    } catch {
      form.setError('pocketApiUrl', {
        type: 'manual',
        message: 'Could not reach the API endpoint. Check the URL and ensure the node is accessible.',
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
        <form ref={formRef} onSubmit={form.handleSubmit(submit)} className="grid grid-cols-2 gap-x-6 gap-y-5">
          {/* Left column */}
          <div className="flex flex-col gap-5">
            <FormField
              name="appIdentity"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App Identity</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={true}/>
                  </FormControl>
                  <FormDescription>
                    Your public identifier, derived from the <code>APP_IDENTITY</code> private key.
                    Verify it matches the address in your{' '}
                    <a href="https://github.com/pokt-network/igniter-governance" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}>governance registration</a>.
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />

            <FormField
              name="indexerApiUrl"
              control={form.control}
              render={({ field }) => {
                const isDisabled = !chainId || !pocketApiUrl;
                return (
                <FormItem>
                  <FormLabel>Indexer API URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={isDisabled}
                      placeholder="https://api.poktscan.com"
                    />
                  </FormControl>
                  <FormDescription>
                    The POKTscan GraphQL API for your network. Used to fetch supplier rewards and on-chain data.
                    Must match the same network as your Node API.
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
                );
              }}
            />
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5">
            <FormField
              name="pocketApiUrl"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pocket API URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="https://your-pocket-api.example.com"
                    />
                  </FormControl>
                  <FormDescription>
                    The Cosmos SDK REST API of your Pocket Network node (port <code>1317</code>).
                    <strong> Do not use the Tendermint RPC</strong> (port <code>26657</code>).
                    This auto-detects your network and minimum stake. The chain ID is locked after setup.
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />

            <FormField
              name="pocketRpcUrl"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pocket RPC URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="https://your-pocket-rpc.example.com"
                    />
                  </FormControl>
                  <FormDescription>
                    The Tendermint RPC endpoint of your Pocket Network node (port <code>26657</code>).
                  </FormDescription>
                  <FormMessage/>
                </FormItem>
              )}
            />

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
                      Auto-detected. Locked after setup.
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
                    <FormLabel>Minimum Stake</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={true}/>
                    </FormControl>
                    <FormDescription>
                      Auto-detected (uPOKT).
                    </FormDescription>
                    <FormMessage/>
                  </FormItem>
                )}
              />
            </div>
          </div>
        </form>
      </Form>

      <SetupHelpBar docAnchor="step-1--blockchain-settings">
        <span className="text-sm text-muted-foreground">Quick fill both URLs:</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all hover:brightness-110"
          style={{ background: 'rgba(72, 229, 194, 0.12)', border: '1px solid rgba(72, 229, 194, 0.25)', color: 'var(--pnf-mint, #48e5c2)' }}
          onClick={() => {
            form.setValue('pocketApiUrl', 'https://sauron-api.infra.pocket.network', { shouldDirty: true });
            form.setValue('pocketRpcUrl', 'https://sauron-rpc.infra.pocket.network', { shouldDirty: true });
            form.setValue('indexerApiUrl', 'https://api.poktscan.com', { shouldDirty: true });
          }}
        >
          Mainnet
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all hover:brightness-110"
          style={{ background: 'rgba(255, 197, 71, 0.12)', border: '1px solid rgba(255, 197, 71, 0.25)', color: 'var(--pnf-gold, #ffc547)' }}
          onClick={() => {
            form.setValue('pocketApiUrl', 'https://sauron-api.beta.infra.pocket.network', { shouldDirty: true });
            form.setValue('pocketRpcUrl', 'https://sauron-rpc.beta.infra.pocket.network', { shouldDirty: true });
            form.setValue('indexerApiUrl', 'https://beta-api.poktscan.com', { shouldDirty: true });
          }}
        >
          Beta
        </button>
      </SetupHelpBar>

      <div className="flex justify-end">
        <Button type="button" onClick={handleGoNext} disabled={isLoading || isValidating || isSubmitting || isValidatingRpc || isLoadingBlockchainParams || !!form.formState.errors.pocketApiUrl || !!form.formState.errors.pocketRpcUrl}>
          {isLoading ? 'Loading...' : 'Next'}
        </Button>
      </div>
    </div>
  )
}

export default FormComponent
