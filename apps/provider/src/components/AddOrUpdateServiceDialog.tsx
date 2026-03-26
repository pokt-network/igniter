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
import {Trash2Icon} from "lucide-react";
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
  const [allServicesOnChain, setAllServicesOnChain] = useState<ServiceOnChain[]>([]);
  const [filteredServices, setFilteredServices] = useState<ServiceOnChain[]>([]);
  const [isLoadingAllServices, setIsLoadingAllServices] = useState(true);
  const [hasLoadServiceError, setHasLoadServiceError] = useState(false);
  const [isCancelling, setIsCanceling] = useState(false);
  const [patternHelp, setPatternHelp] = useState<{ input: string; result: string, ag: string, region: Region } | undefined>();
  const [isCreatingService, setIsCreatingService] = useState(false);
  const [isUpdatingService, setIsUpdatingService] = useState(false);
  const [settings, setSettings] = useState<ApplicationSettings>();
  const [serviceExists, setServiceExists] = useState(false);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    (async () => {
      const appSettings = await GetApplicationSettings();
      setSettings(appSettings);
      if (!appSettings?.rpcUrl) { setIsLoadingAllServices(false); return; }

      try {
        const baseUrl = urlJoin(appSettings.rpcUrl, '/pokt-network/poktroll/service/service');
        let allServices: ServiceOnChain[] = [];
        let nextKey: string | null = null;

        do {
          const params = new URLSearchParams({ 'pagination.limit': '500' });
          if (nextKey) params.set('pagination.key', nextKey);
          const response = await fetch(`${baseUrl}?${params}`);
          if (!response.ok) throw new Error('Failed to fetch services');
          const data = await response.json();
          const pageServices = (data.service || []).map((s: any) => ({
            serviceId: s.id, name: s.name,
            ownerAddress: s.owner_address,
            computeUnits: parseInt(s.compute_units_per_relay),
          }));
          allServices = [...allServices, ...pageServices];
          nextKey = data.pagination?.next_key || null;
        } while (nextKey);

        setAllServicesOnChain(allServices);
      } catch (error) {
        console.error("Failed to load services from chain:", error);
        setHasLoadServiceError(true);
      } finally {
        setIsLoadingAllServices(false);
      }
    })();
  }, []);

  const checkLocalService = useCallback(async (serviceId: string) => {
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
    }
  }, [service]);

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

  // Filter services locally as user types
  useEffect(() => {
    if (!serviceId || serviceId.length === 0) {
      setFilteredServices([]);
      setServiceOnChain(undefined);
      setServiceExists(false);
      return;
    }

    const query = serviceId.toLowerCase();
    const matches = allServicesOnChain.filter(
      s => s.serviceId.toLowerCase().includes(query) || s.name.toLowerCase().includes(query)
    );
    setFilteredServices(matches);

    // Exact match — select it
    const exactMatch = allServicesOnChain.find(s => s.serviceId === serviceId);
    if (exactMatch) {
      setFilteredServices([]);
      checkLocalService(serviceId).then(exists => {
        if (!exists) {
          setServiceOnChain(exactMatch);
        }
      });
    } else {
      setServiceOnChain(undefined);
      setServiceExists(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

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
        className="gap-0 p-0 rounded-lg bg-bg-elevated !w-[700px] !min-w-none !max-w-none max-h-[90vh] overflow-y-auto overflow-x-hidden"
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

        <div className="px-4 py-3">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">

              {/* Service ID search */}
              <FormField
                name="serviceId"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service ID {isLoadingAllServices && <LoaderIcon className="inline-block animate-spin ml-1 h-3 w-3" />}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          disabled={!!service}
                          placeholder={isLoadingAllServices ? "Loading services..." : "Type to search services..."}
                          {...field}
                          autoComplete="off"
                        />
                        {filteredServices.length > 0 && !serviceOnChain && serviceId.length > 0 && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-border-primary bg-bg-elevated shadow-lg">
                            {filteredServices.slice(0, 20).map((s) => (
                              <button
                                key={s.serviceId}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex justify-between items-center gap-4"
                                onClick={() => {
                                  form.setValue('serviceId', s.serviceId, { shouldValidate: true });
                                }}
                              >
                                <span className="font-mono font-medium shrink-0">{s.serviceId}</span>
                                <span className="text-text-tertiary text-xs truncate">{s.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Status messages */}
              {!serviceOnChain && !hasLoadServiceError && !serviceExists && serviceId.length === 0 && (
                <div className="text-sm text-text-tertiary text-center py-4">
                  Search and select a service from the chain to continue
                </div>
              )}

              {!serviceOnChain && hasLoadServiceError && (
                <div className="text-sm text-center py-4 px-3 rounded-md" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                  Failed to load services from chain. Check your Pocket API URL.
                </div>
              )}

              {serviceExists && (
                <div className="text-sm text-center py-4 px-3 rounded-md" style={{ background: 'rgba(255,197,71,0.08)', border: '1px solid rgba(255,197,71,0.2)', color: '#ffc547' }}>
                  This service is already registered. Edit it from the Services list.
                </div>
              )}

              {/* Service details (shown after selection) */}
              {serviceOnChain && (
                <>
                  <div className="flex flex-col gap-2 rounded-md p-3 overflow-hidden" style={{ background: 'var(--bg-surface, rgba(255,255,255,0.03))', border: '1px solid var(--border-primary)' }}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-text-tertiary shrink-0 w-24">Name</span>
                      <span className="text-sm break-all">{serviceOnChain.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-tertiary shrink-0 w-24">Owner</span>
                      <span className="text-sm font-mono">{getShortAddress(serviceOnChain.ownerAddress)}</span>
                      <button
                        type="button"
                        className="text-text-tertiary hover:text-text-primary transition-colors"
                        onClick={() => navigator.clipboard.writeText(serviceOnChain.ownerAddress)}
                        title="Copy address"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </button>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-text-tertiary shrink-0 w-24">Compute Units</span>
                      <span className="text-sm font-medium">{serviceOnChain.computeUnits.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Endpoints / Protocols */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Protocols</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addEndpoint}
                      style={{ borderColor: 'var(--pnf-blue-light, #5ba3f5)', color: 'var(--pnf-blue-light, #5ba3f5)' }}
                    >
                      Add Protocol
                    </Button>
                  </div>

                  <div className="flex flex-col gap-3">
                    {endpoints.map((_, index) => (
                      <div key={index} className="flex flex-col gap-2 p-3 rounded-md" style={{ border: '1px solid var(--border-primary)' }}>
                        <div className="flex gap-3 items-start">
                          <FormField
                            name={`endpoints.${index}.rpcType`}
                            control={form.control}
                            render={({ field }) => (
                              <FormItem className="w-48 shrink-0">
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

                          <FormField
                            name={`endpoints.${index}.url`}
                            control={form.control}
                            render={({ field }) => (
                              <FormItem className="flex-grow">
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

                          <div className="flex gap-1 shrink-0 pt-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (endpoints[index]) {
                                  setPatternHelp({
                                    input: endpoints[index].url || getDefaultUrlWithSchemeByRpcType(endpoints[index].rpcType),
                                    ag: 'rm-01',
                                    region: Region.AFRICA_SOUTH,
                                    result: getEndpointInterpolatedUrl(endpoints[index], {
                                      rm: 'rm-01',
                                      region: Region.AFRICA_SOUTH,
                                      sid: serviceId,
                                      domain: 'example.com',
                                    })
                                  })
                                }
                              }}
                              title="URL pattern help"
                            >
                              <InfoIcon className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={endpoints.length <= 1}
                              onClick={() => removeEndpoint(index)}
                              title="Remove protocol"
                            >
                              <Trash2Icon className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </form>
          </Form>
        </div>

        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <DialogFooter className="p-4">
          <Button
            variant="outline"
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
