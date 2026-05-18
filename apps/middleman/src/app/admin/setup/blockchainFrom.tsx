"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@igniter/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@igniter/ui/components/form";
import { Input } from "@igniter/ui/components/input";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RetrieveBlockchainSettings,
  RetrieveIndexerNetwork,
  UpsertApplicationSettings,
  ValidateRpcEndpoint,
} from '@/actions/ApplicationSettings'
import { ApplicationSettings } from "@igniter/db/middleman/schema";
import { ChainId } from "@igniter/db/middleman/enums";

interface FormProps {
  defaultValues: Partial<ApplicationSettings>;
  goNext: () => void;
}

const RpcUrlSchema = z.string().url("Please enter a valid URL").min(1, "URL is required");

export const FormSchema = z.object({
  chainId: z.nativeEnum(ChainId),
  pocketApiUrl: RpcUrlSchema,
  pocketRpcUrl: RpcUrlSchema,
  indexerApiUrl: RpcUrlSchema,
  appIdentity: z.string().min(1, "App Identity is Required"),
  updatedAtHeight: z.string().nullable(),
  minimumStake: z.coerce.number(),
}).superRefine(async (values, ctx) => {
  if (!values.indexerApiUrl) {
    return; // Skip validation if empty
  }

  try {
    const indexerNetwork = await RetrieveIndexerNetwork(values.indexerApiUrl);

    if (indexerNetwork !== values.chainId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Indexer network (${indexerNetwork}) does not match chain ID (${values.chainId})`,
        path: ['indexerApiUrl'],
      });
      return false;
    }

  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Failed to validate Indexer API URL",
      path: ['indexerApiUrl'],
    });
    return false;
  }
});

type FormValues = z.infer<typeof FormSchema>;

const FormComponent: React.FC<FormProps> = ({ defaultValues, goNext }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBlockchainParams, setIsLoadingBlockchainParams] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      pocketApiUrl: defaultValues?.pocketApiUrl || "",
      pocketRpcUrl: defaultValues?.pocketRpcUrl || "",
      indexerApiUrl: defaultValues?.indexerApiUrl || "",
      minimumStake: defaultValues?.minimumStake,
      chainId: defaultValues?.chainId,
      updatedAtHeight: defaultValues?.updatedAtHeight ?? null,
      appIdentity: defaultValues?.appIdentity || "",
    },
  });

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rpcDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [isValidatingRpc, setIsValidatingRpc] = useState(false);

  const { isValidating, isSubmitting } = form.formState
  const [pocketApiUrl, pocketRpcUrl, chainId] = form.watch([
    'pocketApiUrl',
    'pocketRpcUrl',
    'chainId'
  ])

  const debouncedRetrieveParams = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    form.clearErrors('pocketApiUrl');
    form.clearErrors('indexerApiUrl');
    form.setValue('updatedAtHeight', null);

    debounceTimerRef.current = setTimeout(() => {
      if (pocketApiUrl && pocketApiUrl.trim() !== '') {
        retrieveBlockchainParams();
      }
    }, 1000);
  }, [pocketApiUrl]);

  useEffect(() => {
    debouncedRetrieveParams();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [pocketApiUrl, debouncedRetrieveParams]);

  useEffect(() => {
    if (!pocketRpcUrl || pocketRpcUrl.trim() === '') return;
    form.clearErrors('pocketRpcUrl');
    if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current);
    rpcDebounceRef.current = setTimeout(async () => {
      try {
        setIsValidatingRpc(true);
        const result = await ValidateRpcEndpoint(pocketRpcUrl);
        if (!result.success) {
          form.setError('pocketRpcUrl', { type: 'manual', message: result.error || 'Invalid RPC endpoint' });
        } else if (result.network && chainId && result.network !== chainId) {
          form.setError('pocketRpcUrl', { type: 'manual', message: `RPC is on network "${result.network}" but API detected "${chainId}". Both must point to the same chain.` });
        }
      } catch {
        form.setError('pocketRpcUrl', { type: 'manual', message: 'Could not reach the RPC endpoint.' });
      } finally {
        setIsValidatingRpc(false);
      }
    }, 1000);
    return () => { if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current); };
  }, [pocketRpcUrl]);

  const isUpdate = useMemo(() => defaultValues?.id !== 0, [defaultValues]);
  const formRef = useRef<HTMLFormElement>(null);

  const handleGoNext = () => {
    formRef.current?.requestSubmit();
  };

  const retrieveBlockchainParams = async () => {
    const url = form.getValues().pocketApiUrl;
    const validatedUrl = RpcUrlSchema.safeParse(url);

    if (!validatedUrl.success) {
      form.setError('pocketApiUrl', {
        type: 'manual',
        message: 'Please enter a valid URL',
      });
      return;
    }

    try {
      setIsLoadingBlockchainParams(true);

      const updatedAtHeight = form.getValues().updatedAtHeight;

      const response = await RetrieveBlockchainSettings(validatedUrl.data, updatedAtHeight);

      if (!response.success && response.errors) {
        const [error] = response.errors;
        form.setError('pocketApiUrl', {
          type: 'manual',
          message: error,
        });
        return;
      } else if (response.network && response.height && response.minStake) {
        form.setValue("chainId", response.network as ChainId);
        form.setValue("minimumStake", response.minStake);
        form.setValue("updatedAtHeight", response.height);
      }
    } catch {
      form.setError('pocketApiUrl', {
        type: 'manual',
        message: 'Could not reach the API endpoint. Check the URL and ensure the node is accessible.',
      });
    } finally {
      setIsLoadingBlockchainParams(false);
    }
  };

  const submit = async (values: FormValues) => {
    setIsLoading(true);
    try {
      await UpsertApplicationSettings(values, isUpdate);
      goNext();
    } catch (error) {
      console.error("Something failed while updating the application settings", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col justify-between gap-4">
      <Form {...form}>
        <form ref={formRef} onSubmit={form.handleSubmit(submit)} className="grid gap-4">
          <FormField
            name="appIdentity"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>App Identity</FormLabel>
                <FormControl>
                  <Input {...field} disabled={true} />
                </FormControl>
                <FormMessage />
                <FormDescription>
                  Your App Identity is the unique public identifier derived from your private key.
                </FormDescription>
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-4">
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
                    Cosmos SDK REST API endpoint (port <code>1317</code>). Auto-detects network and minimum stake.
                  </FormDescription>
                  <FormMessage />
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
                    CometBFT RPC endpoint (port <code>26657</code>). Used to broadcast and verify transactions.
                  </FormDescription>
                  <FormMessage />
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
                    <Input {...field} disabled={true} />
                  </FormControl>
                  <FormMessage />
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
                    <Input {...field} disabled={true} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
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
                        placeholder="https://indexer.pocket.network"
                      />
                    </FormControl>
                    <FormDescription>
                      The GraphQL API URL of the POKTscan indexer for your network. Used to retrieve rewards calculations.
                      Must match the same network as your RPC.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          </div>
        </form>
      </Form>

      <div className="flex justify-end">
        <Button type="button" onClick={handleGoNext} disabled={isLoading || isSubmitting || isValidating || isValidatingRpc || isLoadingBlockchainParams || !!form.formState.errors.pocketApiUrl || !!form.formState.errors.pocketRpcUrl}>
          {isLoading ? "Loading..." : "Next"}
        </Button>
      </div>
    </div>
  );
};

export default FormComponent;
