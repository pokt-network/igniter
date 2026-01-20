"use client";

import {zodResolver} from "@hookform/resolvers/zod";
import {useForm} from "react-hook-form";
import {z} from "zod";
import {Button} from "@igniter/ui/components/button";
import {getShortAddress} from "@igniter/ui/lib/utils";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@igniter/ui/components/form";
import {Input} from "@igniter/ui/components/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from "@igniter/ui/components/select";
import {Dialog, DialogContent, DialogFooter, DialogTitle,} from "@igniter/ui/components/dialog";
import {
  getDefaultUrlWithSchemeByRpcType,
  getEndpointInterpolatedUrl,
} from "@igniter/domain/provider/utils";
import {
    PROTOCOL_DEFAULT_TYPE as PROTOCOL_DEFAULT_RPC_TYPE,
} from '@igniter/domain/provider/constants';
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {InfoIcon, LoaderIcon} from "@igniter/ui/assets";
import urlJoin from "url-join";
import {CreateService, UpdateService, GetByServiceId} from "@/actions/Services";
import type {ApplicationSettings, Service} from "@igniter/db/provider/schema";
import {GetApplicationSettings} from "@/actions/ApplicationSettings";
import {Region} from "@/lib/models/commons";
import { labelByRpcType, validRpcTypes as validRpcTypesEnums } from '@/lib/constants'
import {RPCTypeMap} from '@igniter/pocket/constants';
import type {ValidRPCTypes} from '@igniter/pocket';

interface ServiceOnChain {
  serviceId: string;
  name: string;
  ownerAddress: string;
  computeUnits: number;
}

const PROTOCOL_DEFAULT_TYPE = PROTOCOL_DEFAULT_RPC_TYPE.toString();

const DEFAULT_ENDPOINTS = [{ url: "", rpcType: PROTOCOL_DEFAULT_TYPE }]

const validRpcTypes = [
  validRpcTypesEnums[0].toString(),
  validRpcTypesEnums[1].toString(),
  validRpcTypesEnums[2].toString(),
  validRpcTypesEnums[3].toString(),
] as const;

const RPCTypeSchema = z.enum(validRpcTypes).default(PROTOCOL_DEFAULT_TYPE).transform(v => Number(v));

const preprocessRpcType = (v: unknown) => {
  if (!v || !RPCTypeMap[v as ValidRPCTypes]) {
    return PROTOCOL_DEFAULT_TYPE;
  }

  return  RPCTypeMap[v as ValidRPCTypes]?.toString() ?? PROTOCOL_DEFAULT_TYPE;
}

const preprocessEndpoints = (v: unknown) => {
  if (!v || !Array.isArray(v)) {
    return DEFAULT_ENDPOINTS
  }

  return v.map((endpoint) => ({
    ...endpoint,
    rpcType: preprocessRpcType(endpoint.rpcType),
  }));
}

const endpointSchema = z.object({
  url: z.string(),
  rpcType: z.preprocess(preprocessRpcType, RPCTypeSchema),
}).transform((data) => ({
  ...data,
  url: data.url || getDefaultUrlWithSchemeByRpcType(data.rpcType)
}));

const CreateServiceFormSchema = z.object({
  serviceId: z.string().min(1, "Service ID is required"),
  revSharePercentage: z.coerce.number().min(0).max(100).nullable(),
  // TODO: refine to prevent duplicate rpc types
  endpoints: z.array(endpointSchema).min(1, "At least one endpoint is required"),
});

export interface AddServiceDialogProps {
  onClose?: (shouldRefreshServices: boolean) => void;
  service?: Pick<Service, 'serviceId' | 'name' | 'endpoints' | 'revSharePercentage'>;
}

interface ServiceResponse {
  service: {
    id: string;
    name: string;
    compute_units_per_relay: string;
    owner_address: string;
  }
}

export function AddOrUpdateServiceDialog({
                                             onClose,
                                             service,
                                           }: Readonly<AddServiceDialogProps>) {
  const [endpoints, setEndpoints] = useState<{ url: string; rpcType: number }[]>(preprocessEndpoints(service?.endpoints));

  const [serviceOnChain, setServiceOnChain] = useState<ServiceOnChain>();
  const [isLoadingService, setIsLoadingService] = useState(false);
  const serviceIdInputRef = useRef<HTMLInputElement>(null);
  const [hasLoadServiceError, setHasLoadServiceError] = useState(false);
  const [isCancelling, setIsCanceling] = useState(false);
  const [patternHelp, setPatternHelp] = useState<{ input: string; result: string, ag: string, region: Region } | undefined>();
  const [isCreatingService, setIsCreatingService] = useState(false);
  const [isUpdatingService, setIsUpdatingService] = useState(false);
  const [settings, setSettings] = useState<ApplicationSettings>();
  const [serviceExists, setServiceExists] = useState(false);

  const SERVICE_BY_ID_URL = useMemo(() => {
    if (settings?.rpcUrl) {
      return urlJoin(settings?.rpcUrl, '/pokt-network/poktroll/service/service/{service-id}');
    }

    return '';
  }, [settings?.rpcUrl]);

  const checkLocalService = useCallback(async (serviceId: string) => {
    setIsLoadingService(true);
    try {
      const result = await GetByServiceId(serviceId);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      if (result.data && !service) {
        setServiceExists(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error checking local service:", error);
      return false;
    } finally {
      setIsLoadingService(false);
    }
  }, [service]);

  const fetchService = useCallback(async (serviceId: string) => {
    if (!serviceId) return;
    setIsLoadingService(true);

    try {
      const response = await fetch(
        SERVICE_BY_ID_URL.replace("{service-id}", serviceId)
      );

      if (!response.ok) {
        throw new Error("Failed to fetch service");
      }

      const data = await response.json() as ServiceResponse;

      return {
        serviceId: data.service.id,
        name: data.service.name,
        ownerAddress: data.service.owner_address,
        computeUnits: parseInt(data.service.compute_units_per_relay),
      };
    } catch (error) {
      console.error("Error fetching service:", error);
      setHasLoadServiceError(true);
    } finally {
      setIsLoadingService(false);
    }
  }, [SERVICE_BY_ID_URL, checkLocalService]);

  const focusServiceIdInput = useCallback(() => {
    if (serviceIdInputRef.current) {
      serviceIdInputRef.current.focus();
    }
  }, [serviceIdInputRef.current]);

  useEffect(() => {
    (async () => {
      const settings = await GetApplicationSettings();
      setSettings(settings);
    })();
  }, []);

  const form = useForm<z.infer<typeof CreateServiceFormSchema>>({
    resolver: zodResolver(CreateServiceFormSchema),
    defaultValues: {
      serviceId: service?.serviceId || "",
      revSharePercentage: service?.revSharePercentage || null,
      endpoints: preprocessEndpoints(service?.endpoints),
    },
  });

  const {isDirty} = form.formState

  const handleCancel = useCallback(() => {
    if (serviceOnChain && isDirty) {
      setIsCanceling(true);
    } else {
      onClose?.(false);
    }
  }, [isDirty, serviceOnChain, setIsCanceling, onClose]);

  const serviceId = form.watch('serviceId');

  useEffect(() => {
    setServiceExists(false);
    setHasLoadServiceError(false);
  }, [serviceId]);

  useEffect(() => {
    // TODO: change to use react-query
    const fetchServiceData = async () => {
      if (SERVICE_BY_ID_URL && serviceId && serviceId.length > 0) {
        try {
          const exists = await checkLocalService(serviceId);

          if (exists) {
            return;
          }
          const service = await fetchService(serviceId);
          setServiceOnChain(service);
        } catch (error) {
          setServiceOnChain(undefined);
        } finally {
          focusServiceIdInput();
        }
      } else {
        setServiceOnChain(undefined);
      }
    };

    const debounceTimer = setTimeout(() => {
      fetchServiceData();
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [serviceId, SERVICE_BY_ID_URL]);

  const endpointsOnForm = form.watch('endpoints');

  useEffect(() => {
    setEndpoints([...endpointsOnForm]);
  }, [JSON.stringify(endpointsOnForm)]);

  const addEndpoint = () => {
    form.setValue("endpoints", [...endpoints, { url: "", rpcType: Number(PROTOCOL_DEFAULT_TYPE) }]);
  };

  const removeEndpoint = (index: number) => {
    if (endpoints.length > 1) {
      const newEndpoints = [...endpoints];
      newEndpoints.splice(index, 1);
      form.setValue("endpoints", newEndpoints);
    }
  };

  async function onSubmit(values: z.infer<typeof CreateServiceFormSchema>) {
    if (service) {
      setIsUpdatingService(true);
      try {
        const result = await UpdateService(service.serviceId, {
          revSharePercentage: values.revSharePercentage,
          endpoints: values.endpoints.slice(),
        });
        if (!result.success) {
          throw new Error(result.error.message);
        }
        onClose?.(true);
      } catch (e) {
        console.error("Failed to update service", e);
      } finally {
        setIsUpdatingService(false);
      }
    } else {
      setIsCreatingService(true);
      try {
        const result = await CreateService({
          serviceId: values.serviceId,
          name: serviceOnChain?.name ?? 'Unknown Service',
          ownerAddress: serviceOnChain?.ownerAddress ?? '',
          computeUnits: serviceOnChain?.computeUnits ?? 1,
          revSharePercentage: values.revSharePercentage,
          endpoints: values.endpoints.slice(),
        });
        if (!result.success) {
          throw new Error(result.error.message);
        }
        onClose?.(true);
      } catch (e) {
        console.error("Failed to create service", e);
      } finally {
        setIsCreatingService(false);
      }
    }
  }

  return (
    <Dialog
      open={true}
    >
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        className={`gap-0 p-0 rounded-lg bg-[var(--color-slate-2)] ${serviceOnChain ? '!w-[900px]' : '!w-[350px]'} !min-w-none !max-w-none h-[550px]`}
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-4 px-4">
            <span className="text-[14px]">
              {service ? `Update Service: ${service.name}` : "Add New Service"}
            </span>
          </div>
        </DialogTitle>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>

        <div className="px-4 py-3 min-h-[384px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">

              <div className="grid grid-cols-24 gap-1">
                <div className={`${serviceOnChain ? 'col-span-10' : 'col-span-24'} flex flex-col gap-4 px-2`}>
                  <FormField
                    name="serviceId"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem className="flex flex-col gap-2">
                        <FormLabel>Service ID</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isLoadingService || !!service}
                            {...field}
                            ref={(e) => {
                              field.ref(e);
                              serviceIdInputRef.current = e;
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!serviceOnChain && !hasLoadServiceError && !serviceExists && (
                    <div className="flex justify-center items-center p-3 rounded-md">
                      Specify the service on-chain ID before you can continue
                    </div>
                  )}

                  {!serviceOnChain && hasLoadServiceError && (
                    <div className="flex justify-center items-center bg-[var(--color-slate-3)] p-3 rounded-md">
                      There was an error loading the service. Does it exist?
                    </div>
                  )}

                  {serviceExists && (
                    <div className="flex justify-center items-center bg-[var(--color-slate-3)] p-3 rounded-md">
                      This service ID is already registered in your local database. You can edit it from the Services list.
                    </div>
                  )}

                  {serviceOnChain && (
                    <>
                      <div className="bg-[var(--color-slate-3)] p-3 rounded-md">
                        <div className="flex flex-col gap-2">
                          <div>
                            <span className="text-[var(--color-slate-9)]">Name:</span>{" "}
                            <span>{serviceOnChain.name}</span>
                          </div>
                          <div>
                            <span className="text-[var(--color-slate-9)]">Owner:</span>{" "}
                            <span>{getShortAddress(serviceOnChain.ownerAddress)}</span>
                          </div>
                          <div>
                            <span className="text-[var(--color-slate-9)]">Compute Units:</span>{" "}
                            <span>{serviceOnChain.computeUnits}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {serviceOnChain && (
                  <div className="col-span-14 flex flex-col gap-4 px-2 max-h-[384px] overflow-y-auto">
                    <div className="flex flex-col gap-4">
                      <div className="flex justify-end items-center px-1">
                        <FormLabel
                          className="text-[var(--color-slate-9)] cursor-pointer hover:underline"
                          onClick={addEndpoint}
                        >
                          Add Protocol
                        </FormLabel>
                      </div>

                      {endpoints.map((_, index) => (
                        <div key={index} className="grid gap-2 p-3 border border-[var(--slate-dividers)] rounded-md">
                          <div className="flex justify-end px-1">
                            <FormLabel
                              className={`text-[var(--color-slate-9)] ${endpoints.length > 1 && 'hover:underline cursor-pointer'} ${endpoints.length === 1 && 'opacity-50'}`}
                              onClick={() => removeEndpoint(index)}
                            >
                              Remove
                            </FormLabel>
                          </div>

                          <FormField
                            name={`endpoints.${index}.rpcType`}
                            control={form.control}
                            render={({ field }) => (
                              <FormItem>
                                <Select
                                  onValueChange={field.onChange}
                                  defaultValue={field.value.toString()}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select RPC Type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {validRpcTypes.map((type) => (
                                      <SelectItem key={`type-${type}`} value={type}>
                                        {labelByRpcType[type] || type}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <div className="flex gap-2 items-center">
                            <FormField
                              name={`endpoints.${index}.url`}
                              control={form.control}
                              render={({ field }) => (
                                <FormItem
                                  className="flex-grow"
                                  >
                                  <FormControl>
                                    <Input
                                      placeholder={getDefaultUrlWithSchemeByRpcType(form.getValues(`endpoints.${index}.rpcType`))}
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <InfoIcon
                              className="cursor-pointer"
                              onClick={() => {
                                if (endpoints[index]) {
                                  setPatternHelp({
                                    input: endpoints[index].url || getDefaultUrlWithSchemeByRpcType(endpoints[index].rpcType),
                                    ag: 'rm-01', // Hard-coded address group for help
                                    region: Region.AFRICA_SOUTH, // Hard-coded region for help
                                    result: getEndpointInterpolatedUrl(endpoints[index], {
                                      rm: 'rm-01', // Hard-coded relay miner identity for help
                                      region: Region.AFRICA_SOUTH, // Hard-coded region for help
                                      sid: serviceId,
                                      domain: 'example.com',
                                    })
                                  })
                                }
                              }}
                              />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </form>
          </Form>
        </div>

        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <DialogFooter className="p-2 flex flex-row ">
          <Button
            variant="secondary"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            onClick={form.handleSubmit(onSubmit)}
            disabled={isCreatingService || isUpdatingService || !serviceOnChain}
          >
            {service ? "Update Service" : "Add Service"}
          </Button>
        </DialogFooter>
        {isCancelling && (
          <div
            className="absolute inset-0 bg-background flex flex-col items-center justify-center p-6 animate-in fade-in"
          >
            <h3 className="text-lg font-semibold mb-4">
              Are you sure you want to cancel?
            </h3>
            <p className="mb-6 text-muted-foreground text-center">
              Your changes for this service will be discarded.
            </p>
            <div className="flex gap-4">
              <Button variant="destructive" onClick={() => onClose?.(false)}>
                Discard
              </Button>
              <Button variant="outline" onClick={() => setIsCanceling(false)}>
                Continue Editing
              </Button>
            </div>
          </div>
        )}
        {patternHelp && (
          <div
            className="absolute inset-0 bg-background flex flex-col gap-6 p-6 animate-in fade-in"
          >
            <h3 className="text-lg font-medium">URL Pattern Variables</h3>

            <p className="text-sm text-muted-foreground">
              When new staking nodes are requested, we automatically build the URLs you’ll use to configure each service. The placeholders you can include in those URLs are:
            </p>

            <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
              <div className="font-medium">{`{rm}`}</div>
              <div className="text-sm">The identity of the relay miner associated to the address group the supplier belongs</div>
            </div>

            <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
              <div className="font-medium">{`{region}`}</div>
              <div className="text-sm">The region assigned to the address group</div>
            </div>

            <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
              <div className="font-medium">{`{sid}`}</div>
              <div className="text-sm">The on-chain ID of this service instance</div>
            </div>

            <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
              <div className="font-medium">{`{type}`}</div>
              <div className="text-sm">A URL-friendly label for the chosen RPC protocol</div>
            </div>

            <div className="grid grid-cols-[80px_1fr] gap-2 items-start">
              <div className="font-medium">{`{domain}`}</div>
              <div className="text-sm">The domain configured at the application level or the address group level</div>
            </div>

            <div className="flex flex-col gap-2 text-sm bg-muted/50 p-2 rounded">
              <div className="flex items-center gap-2">
                <InfoIcon />
                <span>Assuming an Address Group named "{patternHelp.ag}" configured on the "{patternHelp.region}" region</span>
              </div>
              <span className="px-5.5">For Url: {patternHelp.input}</span>
              <span className="px-5.5">We'll produce: {patternHelp.result}</span>
            </div>

            <div className="flex flex-row-reverse w-full gap-4">
              <Button variant="secondary" onClick={() => setPatternHelp(undefined)}>
                Close
              </Button>
            </div>
          </div>
        )}
        {(isCreatingService || isUpdatingService) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background animate-fade-in z-10">
            <LoaderIcon className="animate-spin" />
            <p className="mt-4">Saving &#34;{serviceOnChain?.name}&#34;</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
