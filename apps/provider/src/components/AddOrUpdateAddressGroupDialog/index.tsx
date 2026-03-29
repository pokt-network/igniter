"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useFormContext } from 'react-hook-form'
import { z } from "zod";
import { Button } from "@igniter/ui/components/button";
import { Trash2Icon } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@igniter/ui/components/dialog";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderIcon } from "@igniter/ui/assets";
import {
  CreateAddressGroup,
  UpdateAddressGroup,
} from "@/actions/AddressGroups";
import type {
  AddressGroupWithDetails,
  Service,
} from "@igniter/db/provider/schema";
import { Combobox } from "./Combobox";
import { getEndpointInterpolatedUrl } from "@igniter/domain/provider/utils";
import { labelByRpcType } from '@/lib/constants'
import {Switch} from "@igniter/ui/components/switch";
import {Label} from "@igniter/ui/components/label";
import {useQuery} from "@tanstack/react-query";
import {ListServices} from "@/actions/Services";
import {ListRelayMiners} from "@/actions/RelayMiners";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@igniter/ui/components/select";
import clsx from 'clsx'

const poktAddressRegex = /^pokt[a-zA-Z0-9]{39,42}$/;

const RevShareItemSchema = z.object({
  address: z.union([
    z.string().regex(poktAddressRegex, "Must be a valid Cosmos address with 'pokt' prefix"),
    z.literal("{of}"),
  ]),
  share: z.string().min(1, {
    message: "Required"
  }).refine((share) => {
    const num = Number(share);
    return !isNaN(num) && num >= 0 && num <= 100;
  }, {
    message: 'Must be a number between 1 and 100',
  }),
});

const RevShareArraySchema = z
  .array(RevShareItemSchema)
  .default([])
  .refine((arr) => {
    // a. Ensure all `address` values are unique
    const seen = new Set<string>();
    for (const item of arr) {
      if (seen.has(item.address)) {
        return false;
      }
      seen.add(item.address);
    }
    return true;
  }, {
    message: "Each address in revShare must be unique",
  });

const ServiceSchema = z.object({
  serviceId: z.string(),
  addSupplierShare: z.boolean().default(false),
  supplierShare: z.string(),
  revShare: RevShareArraySchema,
  endpointOverrides: z.record(z.string(), z.string()).default({}),
}).refine((value) => {
  if (value.supplierShare) {
    const num = Number(value.supplierShare);
    return !isNaN(num) && num >= 0 && num <= 100;
  }
  return true
}, {
  path: ['supplierShare'],
  message: 'Must be a number between 1 and 100',
}).refine((ser) => {
  const totalRevShare = ser.revShare.reduce((sum, item) => sum + Number(item.share), 0);
  return (totalRevShare + Number(ser.supplierShare || 0)) <= 100;
}, {
  message: "Total of revShare percentages must not exceed 100",
});

export const CreateOrUpdateAddressGroupSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required"),

  relayMinerId: z
      .coerce
      .number(),

  linkedAddresses: z
      .array(
          z
              .string()
              .regex(/^pokt[a-zA-Z0-9]{39,42}$/, "Must be a valid Cosmos address with 'pokt' prefix")
      )
      .default([])
      .refine((addresses) => {
        return new Set(addresses).size === addresses.length;
      }, {
        message: "Each linked address must be unique",
      }),


  private: z.boolean().default(false),

  defaultRevShare: z.object({
    addSupplierShare: z.boolean().default(false),
    supplierShare: z.string(),
    revShare: RevShareArraySchema,
  }).default({
    addSupplierShare: false,
    revShare: [],
    supplierShare: '',
  }).refine((value) => {
    if (value.supplierShare) {
      const num = Number(value.supplierShare);
      return !isNaN(num) && num >= 0 && num <= 100;
    }
    return true
  }, {
    path: ['supplierShare'],
    message: 'Must be a number between 1 and 100',
  }).refine((ser) => {
    const totalRevShare = ser.revShare.reduce((sum, item) => sum + Number(item.share), 0);
    return (totalRevShare + Number(ser.supplierShare || 0)) <= 100;
  }, {
    message: "Total of revShare percentages must not exceed 100",
  }),
  services: z
    .array(ServiceSchema)
    .min(1, "You need to assign at least one service")
});

export interface AddOrUpdateAddressGroupProps {
  onClose?: (shouldRefreshAddressGroups: boolean) => void;
  addressGroup?: AddressGroupWithDetails;
}

export interface ServiceItemProps {
  index: number
  service: Service;
  revShare: { address: string; share: string }[];
  addSupplierShare: boolean;
  supplierShare: string | null;
  endpointOverrides: Record<string, string>;
  errors: Record<string, string>;
  isNew?: boolean;
  rm: string;
  region: string;
  domain: string;
  onRemove: () => void;
  onRevShareChange: (newRevShare: { address: string; share: string }[]) => void;
  onAddSupplierShareChange: (newAddSupplierShare: boolean) => void;
  onSupplierShareChange: (newSupplierShare: string) => void;
  onEndpointOverrideChange: (rpcType: string, url: string) => void;
}

type AddressGroupService = z.infer<typeof ServiceSchema>;

const ServiceItem = ({
  index,
                       service,
                       revShare,
                       rm,
                       region,
                       domain,
                       addSupplierShare,
                       supplierShare,
                       endpointOverrides,
                       errors: svcErrors,
                       isNew: isNewService,
                       onRemove,
                       onRevShareChange,
                       onAddSupplierShareChange,
                       onSupplierShareChange,
                       onEndpointOverrideChange,
                     }: Readonly<ServiceItemProps>) => {
  const {formState} = useFormContext<z.infer<typeof CreateOrUpdateAddressGroupSchema>>()
  const [collapsed, setCollapsed] = React.useState(false)
  const [flash, setFlash] = React.useState(isNewService ?? false)

  React.useEffect(() => {
    if (flash) {
      const timer = setTimeout(() => setFlash(false), 800)
      return () => clearTimeout(timer)
    }
  }, [flash])

  const handleChangeAddress = (idx: number, newAddress: string) => {
    const updated = revShare.map((item, i) =>
      i === idx ? { ...item, address: newAddress } : item
    );
    onRevShareChange?.(updated);
  };

  const handleChangePercent = (idx: number, newPct: string) => {
    const updated = revShare.map((item, i) =>
      i === idx ? { ...item, share: newPct } : item
    );
    onRevShareChange?.(updated);
  };

  const handleAddRevShare = () => {
    onRevShareChange?.([...revShare, { address: "", share: ""}]);
  };

  const handleRemoveRevShare = (idx: number) => {
    const updated = revShare.filter((_, i) => i !== idx);
    onRevShareChange?.(updated);
  };

  const serviceError = formState?.errors?.services?.[index]?.message

  return (
    <div
      key={service.serviceId}
      className={clsx(
        "flex flex-col gap-0 rounded-lg overflow-hidden transition-all duration-700",
        flash ? "border border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.2)]" : "border border-border-primary"
      )}
    >
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-2 bg-bg-surface cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
        <div className="flex items-center gap-2 min-w-0">
          <svg className="h-3 w-3 text-text-tertiary transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 4.5L6 7.5L9 4.5" /></svg>
          <span
            className={clsx(
              'text-sm font-semibold block truncate font-mono',
              !!serviceError && 'text-warning'
            )}
            title={`${service.serviceId} — ${service.name}`}
          >
            {service.serviceId}
          </span>
        </div>
        <span
          className="shrink-0 text-xs text-red-500 hover:text-red-400 cursor-pointer hover:underline"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          Remove
        </span>
      </div>

      {/* Endpoints */}
      {!collapsed && service.endpoints && service.endpoints.length > 0 && (
        <div className="px-3 py-3 flex flex-col gap-3">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Endpoints</span>
          {service.endpoints.map((endpoint, epIdx) => {
            const rpcKey = String(endpoint.rpcType);
            const rpcLabel = labelByRpcType[rpcKey] || `RPC ${rpcKey}`;
            const interpolatedUrl = getEndpointInterpolatedUrl(endpoint, {
              sid: service.serviceId,
              rm,
              region,
              domain,
            });
            const overrideValue = endpointOverrides[rpcKey] ?? '';

            const isValidUrl = !overrideValue || (() => {
              const cleaned = overrideValue.replace(/{\w+}/g, 'x');
              return /^(https?|wss?|grpcs?|tcp):\/\/.+/.test(cleaned) && !cleaned.includes('{') && !cleaned.includes('}');
            })();

            return (
              <div key={epIdx} className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-text-secondary">{rpcLabel}</span>
                <Input
                  value={overrideValue}
                  onChange={(e) => onEndpointOverrideChange(rpcKey, e.target.value)}
                  placeholder={interpolatedUrl}
                  className={clsx("text-xs h-8", !isValidUrl && "border-red-500 focus:ring-red-500")}
                />
                {overrideValue && !isValidUrl && (
                  <p className="text-[10px] text-red-400 pl-1">
                    Must be a valid URL (http/https/ws/wss/grpc/grpcs/tcp)
                  </p>
                )}
                {overrideValue && isValidUrl && overrideValue.includes('{') && (() => {
                  const resolvedUrl = getEndpointInterpolatedUrl(
                    { url: overrideValue, rpcType: endpoint.rpcType },
                    { sid: service.serviceId, rm, region, domain }
                  );
                  const hasUnresolved = /{(\w+)}/.test(resolvedUrl);
                  return (
                    <p className={`text-[10px] pl-1 truncate ${hasUnresolved ? 'text-red-400' : 'text-emerald-500/70'}`} title={resolvedUrl}>
                      {hasUnresolved ? 'Unresolved variables in: ' : 'Resolves to: '}{resolvedUrl}
                    </p>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Revenue Shares */}
      {!collapsed && <div className="border-t border-border-primary px-3 py-3 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
            Revenue Shares
          </span>
          <span className="text-xs cursor-pointer hover:underline" style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
            onClick={handleAddRevShare}>
            Add Share
          </span>
        </div>

        {/* Supplier Share row */}
        <div className="grid grid-cols-24 items-center gap-2">
          <span className="col-span-17 text-xs text-text-secondary">Supplier Share</span>
          <Input
            type="number"
            min={1}
            max={100}
            value={supplierShare ?? ''}
            onChange={(e) => onSupplierShareChange(e.target.value)}
            placeholder="%"
            className={clsx("col-span-7 h-8 text-xs text-right", svcErrors['supplierShare'] && "border-red-500")}
          />
        </div>

        {/* Additional shares */}
        {revShare.map((item, idx) => {
          const addrErr = svcErrors[`revShare.${idx}.address`]
          const shareErr = svcErrors[`revShare.${idx}.share`]
          return (
            <div key={idx} className="flex flex-col gap-1">
              <div className="grid grid-cols-24 items-center gap-2">
                <Input
                  className={clsx("col-span-17 h-8 text-xs", addrErr && "border-red-500")}
                  value={item.address}
                  onChange={(e) => handleChangeAddress(idx, e.target.value)}
                  placeholder="pokt…"
                />
                <Input
                  className={clsx("col-span-5 h-8 text-xs", shareErr && "border-red-500")}
                  type="number"
                  min={1}
                  max={100}
                  value={item.share ?? ''}
                  onChange={(e) => handleChangePercent(idx, e.target.value)}
                  placeholder="%"
                />
                <Button
                  variant="ghost"
                  className="col-span-2 h-7"
                  onClick={() => handleRemoveRevShare(idx)}
                  size="icon"
                >
                  <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
              {(addrErr || shareErr) && <p className="text-[10px] text-red-400">{addrErr || shareErr}</p>}
            </div>
          )
        })}
        {svcErrors['total'] && <p className="text-[10px] text-red-400 font-medium">{svcErrors['total']}</p>}
      </div>}
      {serviceError && (
        <p className={'text-sm mt-2 text-warning font-medium px-3 pb-2'}>
          {serviceError}
        </p>
      )}
    </div>
  );
};

export function AddOrUpdateAddressGroupDialog({
                                                onClose,
                                                addressGroup,
                                              }: Readonly<AddOrUpdateAddressGroupProps>) {
  const {data: services, isLoading: isLoadingServices} = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const result = await ListServices();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: []
  });

  const {data: relayMiners, isLoading: isLoadingRelayMiners} = useQuery({
    queryKey: ['relay-miners'],
    queryFn: async () => {
      const result = await ListRelayMiners();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: []
  });

  const [isCancelling, setIsCanceling] = useState(false);
  const [isCreatingAddressGroup, setIsCreatingAddressGroup] = useState(false);
  const [isUpdatingAddressGroup, setIsUpdatingAddressGroup] = useState(false);

  const isLoading = useMemo(() => isLoadingServices || isLoadingRelayMiners, [isLoadingServices, isLoadingRelayMiners]);

  const [assignedServices, setAssignedServices] = useState<string[]>([]);
  const [newServiceIds, setNewServiceIds] = useState<Set<string>>(new Set());

  const form = useForm<z.infer<typeof CreateOrUpdateAddressGroupSchema>>({
    resolver: zodResolver(CreateOrUpdateAddressGroupSchema),
    defaultValues: {
      name: addressGroup?.name ?? "",
      linkedAddresses: addressGroup?.linkedAddresses ?? [],
      private: addressGroup?.private ?? false,
      relayMinerId: addressGroup?.relayMinerId,
      defaultRevShare: {
        addSupplierShare: false,
        supplierShare: '',
        revShare: []
      },
      services:
        addressGroup?.addressGroupServices.map((as) => ({
          serviceId: as.serviceId,
          addSupplierShare: as.addSupplierShare ?? false,
          supplierShare: as.supplierShare?.toString() || '',
          revShare: as.revShare?.map((rs) => ({
            address: rs.address,
            share: rs.share.toString(),
          })) || [],
          endpointOverrides: as.endpointOverrides ?? {},
        })) ?? [],
    },
  });

  // Auto-select relay miner if only one option
  useEffect(() => {
    if (relayMiners.length === 1 && !form.getValues('relayMinerId')) {
      form.setValue('relayMinerId', relayMiners[0].id, { shouldValidate: true });
    }
  }, [relayMiners]);

  const { isValid } = form.formState;

  const handleCancel = useCallback(() => {
    const formValues = form.getValues();
    const defaultValues = form.formState.defaultValues;
    const isDirty = JSON.stringify(formValues) !== JSON.stringify(defaultValues);

    if (isDirty) {
      setIsCanceling(true);
    } else {
      onClose?.(false);
    }
  }, [onClose, form]);

  const handleAddService = useCallback(
    (serviceId: string) => {
      const currentServices = form.getValues("services");
      if (!currentServices.some((s) => s.serviceId === serviceId)) {
        form.setValue("services", [
          { serviceId, ...form.getValues('defaultRevShare')},
          ...currentServices,
        ], { shouldValidate: true });
        setNewServiceIds((prev) => new Set(prev).add(serviceId));
      }
    },
    [form]
  );

  const handleRemoveService = useCallback(
    (serviceId: string) => {
      const currentServices = form.getValues("services");
      form.setValue(
        "services",
        currentServices.filter((s) => s.serviceId !== serviceId),
        { shouldValidate: true }
      );
    },
    [form]
  );

  const servicesOnForm = form.watch(
    "services"
  ) as AddressGroupService[];

  useEffect(() => {
    setAssignedServices(servicesOnForm.map((entry) => entry.serviceId));
  }, [JSON.stringify(servicesOnForm)]);

  const selectableServices = useMemo(() => {
    return services
      .filter((service) => !assignedServices.includes(service.serviceId))
      .map((s) => ({ value: s.serviceId, label: s.name }));
  }, [assignedServices, services]);

  const name = form.watch("name");
  const relayMinerId = form.watch("relayMinerId");
  const linkedAddresses = form.watch("linkedAddresses");

  const allValues = form.watch()

  // Propagate default changes to all services that haven't been customized
  const prevDefaults = React.useRef({
    supplierShare: form.getValues('defaultRevShare.supplierShare') ?? '',
    revShare: JSON.stringify(form.getValues('defaultRevShare.revShare') ?? []),
  })
  const defaultSupplierShareValue = allValues.defaultRevShare?.supplierShare ?? ''
  const defaultRevShareValue = JSON.stringify(allValues.defaultRevShare?.revShare ?? [])

  useEffect(() => {
    const prev = prevDefaults.current
    const normalize = (v: any) => String(Number(v) || 0)
    const supplierChanged = normalize(prev.supplierShare) !== normalize(defaultSupplierShareValue)
    const revShareChanged = prev.revShare !== defaultRevShareValue

    if (!supplierChanged && !revShareChanged) return

    const currentServices = form.getValues('services')
    const updated = currentServices.map((s) => {
      const updates: any = { ...s }

      if (supplierChanged) {
        // Update if service value matches the old default (or is empty/0)
        const svcNorm = normalize(s.supplierShare)
        const prevNorm = normalize(prev.supplierShare)
        if (svcNorm === prevNorm) {
          updates.supplierShare = defaultSupplierShareValue
        }
      }

      if (revShareChanged) {
        const svcRS = JSON.stringify(s.revShare ?? [])
        if (svcRS === prev.revShare) {
          updates.revShare = allValues.defaultRevShare?.revShare ?? []
        }
      }

      return updates
    })

    form.setValue('services', updated, { shouldValidate: true })
    prevDefaults.current = {
      supplierShare: defaultSupplierShareValue,
      revShare: defaultRevShareValue,
    }
  }, [defaultSupplierShareValue, defaultRevShareValue])
  const poktRegex = /^pokt[a-zA-Z0-9]{39,42}$/

  const liveErrors = useMemo(() => {
    const defaultRevShare = allValues.defaultRevShare
    const errors: Record<string, string> = {}

    // Default rev share validation
    const defShares = defaultRevShare?.revShare ?? []
    const defSupplier = Number(defaultRevShare?.supplierShare || 0)

    if (defaultRevShare?.supplierShare && (isNaN(defSupplier) || defSupplier < 0 || defSupplier > 100)) {
      errors['default.supplierShare'] = 'Must be 0-100'
    }

    const defAddrs: string[] = []
    defShares.forEach((rs, i) => {
      if (rs.address && !poktRegex.test(rs.address) && rs.address !== '{of}') {
        errors[`default.revShare.${i}.address`] = 'Invalid POKT address'
      }
      if (rs.address && defAddrs.includes(rs.address)) {
        errors[`default.revShare.${i}.address`] = 'Duplicate address'
      }
      if (rs.address) defAddrs.push(rs.address)
      const num = Number(rs.share)
      if (rs.share && (isNaN(num) || num < 0 || num > 100)) {
        errors[`default.revShare.${i}.share`] = 'Must be 0-100'
      }
    })

    const defTotal = defShares.reduce((s, r) => s + Number(r.share || 0), 0) + defSupplier
    if (defTotal > 100) {
      errors['default.total'] = `Total exceeds 100% (${defTotal}%)`
    }

    // Per-service validation (default + service combined)
    ;(allValues.services ?? []).forEach((svc: any) => {
      const svcSupplier = Number(svc.supplierShare || 0)
      if (svc.supplierShare && (isNaN(svcSupplier) || svcSupplier < 0 || svcSupplier > 100)) {
        errors[`svc.${svc.serviceId}.supplierShare`] = 'Must be 0-100'
      }

      const shareMap = new Map<string, number>()
      for (const rs of defShares) {
        if (rs.address) shareMap.set(rs.address, Number(rs.share || 0))
      }

      const svcAddrs: string[] = []
      ;(svc.revShare ?? []).forEach((rs, i) => {
        if (rs.address && rs.address !== '{of}' && !poktRegex.test(rs.address)) {
          errors[`svc.${svc.serviceId}.revShare.${i}.address`] = 'Invalid POKT address'
        }
        if (rs.address && svcAddrs.includes(rs.address)) {
          errors[`svc.${svc.serviceId}.revShare.${i}.address`] = 'Duplicate address'
        }
        if (rs.address) svcAddrs.push(rs.address)
        if (rs.address) shareMap.set(rs.address, Number(rs.share || 0))
        const num = Number(rs.share)
        if (rs.share && (isNaN(num) || num < 0 || num > 100)) {
          errors[`svc.${svc.serviceId}.revShare.${i}.share`] = 'Must be 0-100'
        }
      })

      const combinedSupplier = Math.max(defSupplier, svcSupplier)
      const combinedTotal = Array.from(shareMap.values()).reduce((s, v) => s + v, 0) + combinedSupplier
      if (combinedTotal > 100) {
        errors[`svc.${svc.serviceId}.total`] = `Total exceeds 100% (${combinedTotal}%)`
      }
    })

    // Linked addresses
    const linked = allValues.linkedAddresses ?? []
    const seenLinked: string[] = []
    linked.forEach((addr: string, i: number) => {
      if (!addr || !addr.trim()) {
        errors[`linked.${i}`] = 'Address cannot be empty'
      } else if (!poktRegex.test(addr)) {
        errors[`linked.${i}`] = 'Invalid POKT address'
      } else if (seenLinked.includes(addr)) {
        errors[`linked.${i}.dup`] = 'Duplicate address'
      }
      if (addr) seenLinked.push(addr)
    })

    return errors
  }, [allValues])

  const hasLiveErrors = Object.keys(liveErrors).length > 0

  const selectedRelayMiner = useMemo(() => {
    return relayMiners.find((rm) => rm.id === Number(relayMinerId));
  }, [relayMinerId]);

  const [submitError, setSubmitError] = useState<string | null>(null)

  async function onSubmit({services, ...values}: z.infer<typeof CreateOrUpdateAddressGroupSchema>) {
    setSubmitError(null)

    const urlPattern = /^(https?|wss?|grpcs?|tcp):\/\/.+/

    for (const s of services) {
      // Validate endpoint overrides
      for (const [, url] of Object.entries(s.endpointOverrides ?? {})) {
        if (url && url.trim()) {
          const testUrl = url.replace(/{\w+}/g, 'x')
          if (!urlPattern.test(testUrl) || testUrl.includes('{') || testUrl.includes('}')) {
            setSubmitError('One or more endpoint URLs are invalid.')
            return
          }
        }
      }

      // Validate supplier share range
      if (s.supplierShare) {
        const num = Number(s.supplierShare)
        if (isNaN(num) || num < 0 || num > 100) {
          setSubmitError('Supplier share must be between 1 and 100.')
          return
        }
      }

      // Validate rev share percentages
      for (const rs of s.revShare) {
        const num = Number(rs.share)
        if (isNaN(num) || num < 0 || num > 100) {
          setSubmitError('Each revenue share must be between 1 and 100.')
          return
        }
      }

      // Validate total rev share <= 100 (default + service-specific + supplier share)
      // Merge default and service shares by address (service overrides default for same address)
      const shareMap = new Map<string, number>()
      for (const rs of (values.defaultRevShare?.revShare ?? [])) {
        if (rs.address) shareMap.set(rs.address, Number(rs.share || 0))
      }
      for (const rs of s.revShare) {
        if (rs.address) shareMap.set(rs.address, Number(rs.share || 0))
      }
      const defaultSupplier = Number(values.defaultRevShare?.supplierShare || 0)
      const serviceSupplier = Number(s.supplierShare || 0)
      const supplierTotal = Math.max(defaultSupplier, serviceSupplier)
      const totalRevShare = Array.from(shareMap.values()).reduce((sum, v) => sum + v, 0) + supplierTotal
      if (totalRevShare > 100) {
        setSubmitError(`Total revenue share for service "${s.serviceId}" exceeds 100% (currently ${totalRevShare}%). This includes default shares + service-specific shares + supplier share.`)
        return
      }

      // Validate unique rev share addresses (within service-specific only, default already validated)
      const svcAddresses = s.revShare.map(r => r.address).filter(Boolean)
      if (new Set(svcAddresses).size !== svcAddresses.length) {
        setSubmitError(`Duplicate revenue share address in service "${s.serviceId}".`)
        return
      }
    }

    // Validate default rev share
    const defaultRS = values.defaultRevShare
    if (defaultRS) {
      if (defaultRS.supplierShare) {
        const num = Number(defaultRS.supplierShare)
        if (isNaN(num) || num < 0 || num > 100) {
          setSubmitError('Default supplier share must be between 1 and 100.')
          return
        }
      }
      for (const rs of defaultRS.revShare) {
        if (!rs.address || !/^pokt[a-zA-Z0-9]{39,42}$/.test(rs.address)) {
          setSubmitError('Default revenue share addresses must be valid POKT addresses.')
          return
        }
        const num = Number(rs.share)
        if (isNaN(num) || num < 0 || num > 100) {
          setSubmitError('Default revenue share must be between 1 and 100.')
          return
        }
      }
      const defaultTotal = defaultRS.revShare.reduce((sum, r) => sum + Number(r.share || 0), 0) + Number(defaultRS.supplierShare || 0)
      if (defaultTotal > 100) {
        setSubmitError(`Default revenue shares total exceeds 100% (currently ${defaultTotal}%).`)
        return
      }
      const defaultAddrs = defaultRS.revShare.map(r => r.address).filter(Boolean)
      if (new Set(defaultAddrs).size !== defaultAddrs.length) {
        setSubmitError('Default revenue share addresses must be unique.')
        return
      }
    }

    // Validate linked addresses
    const linkedAddrs = (values.linkedAddresses ?? []).filter(Boolean)
    if (new Set(linkedAddrs).size !== linkedAddrs.length) {
      setSubmitError('Linked addresses must be unique.')
      return
    }
    for (const addr of linkedAddrs) {
      if (!/^pokt[a-zA-Z0-9]{39,42}$/.test(addr)) {
        setSubmitError('Linked addresses must be valid POKT addresses.')
        return
      }
    }

    // Validate service rev share addresses
    for (const s of services) {
      for (const rs of s.revShare) {
        if (rs.address && rs.address !== '{of}' && !/^pokt[a-zA-Z0-9]{39,42}$/.test(rs.address)) {
          setSubmitError(`Invalid address in revenue share for service "${s.serviceId}".`)
          return
        }
      }
    }

    if (addressGroup) {
      setIsUpdatingAddressGroup(true);
      try {
        const result = await UpdateAddressGroup(
          addressGroup.id,
          values,
          services.map((s) => ({
            ...s,
            addSupplierShare: !!s.supplierShare,
            supplierShare: s.supplierShare ? Number(s.supplierShare) : null,
            revShare: s.revShare.map((rs) => ({
              address: rs.address,
              share: Number(rs.share),
            })),
            endpointOverrides: Object.fromEntries(
              Object.entries(s.endpointOverrides ?? {}).filter(([, v]) => v.trim() !== '')
            ),
          }))
        );
        if (!result.success) {
          throw new Error(result.error.message);
        }
        onClose?.(true);
      } catch (e) {
        console.error("Failed to update addressGroup", e);
      } finally {
        setIsUpdatingAddressGroup(false);
      }
    } else {
      setIsCreatingAddressGroup(true);
      try {
        const result = await CreateAddressGroup(
          values,
          services.map((s) => ({
            ...s,
            addSupplierShare: !!s.supplierShare,
            supplierShare: s.supplierShare ? Number(s.supplierShare) : null,
            revShare: s.revShare.map((rs) => ({
              address: rs.address,
              share: Number(rs.share),
            })),
            endpointOverrides: Object.fromEntries(
              Object.entries(s.endpointOverrides ?? {}).filter(([, v]) => v.trim() !== '')
            ),
          }))
        );
        if (!result.success) {
          throw new Error(result.error.message);
        }
        onClose?.(true);
      } catch (e) {
        console.error("Failed to create addressGroup", e);
      } finally {
        setIsCreatingAddressGroup(false);
      }
    }
  }

  const {append, fields, remove} = useFieldArray({
    control: form.control,
    name: 'defaultRevShare.revShare'
  })

  const defaultRevShareError = form.formState.errors?.defaultRevShare?.message

  return (
    <Dialog open={true}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        className="gap-0 p-0 rounded-lg bg-bg-elevated !w-[1100px] !min-w-none !max-w-none max-h-[90vh] overflow-hidden"
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-3 px-5">
            <span className="text-sm font-semibold">
              {addressGroup
                ? `Update Address Group: ${addressGroup.name}`
                : "New Address Group"}
            </span>
          </div>
        </DialogTitle>
        <div className="h-px bg-border-primary" />

        {!isLoading && (
          <div className="flex-1 overflow-hidden">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="h-full">
                <div className="grid grid-cols-24 h-[calc(90vh-110px)]">
                  <div className="col-span-10 flex flex-col gap-4 p-5 overflow-y-auto border-r border-border-primary">
                    {/* Name */}
                    <FormField
                      name="name"
                      control={form.control}
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-3">
                          <FormLabel className="text-xs shrink-0 whitespace-nowrap w-20">Name</FormLabel>
                          <FormControl>
                            <Input {...field} className="h-8 text-xs" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Relay Miner */}
                    <FormField
                        name="relayMinerId"
                        control={form.control}
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center gap-3">
                              <FormLabel className="text-xs shrink-0 whitespace-nowrap w-20">Relay Miner</FormLabel>
                              <div className="flex-1">
                                <Select
                                    onValueChange={field.onChange}
                                    defaultValue={String(field.value ?? "")}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Select" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {relayMiners.map((rm) => (
                                        <SelectItem key={rm.identity} value={rm.id.toString()}>{`${rm.name} (${rm.identity})`}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </FormItem>
                        )}
                    />

                    {/* Internal use only */}
                    <FormField
                      control={form.control}
                      name="private"
                      render={({ field }) => (
                        <FormItem className="flex flex-col gap-1">
                          <div className="flex flex-row items-center gap-2">
                            <FormLabel className={clsx("text-xs shrink-0 whitespace-nowrap", field.value ? "text-red-400 font-medium" : "text-text-secondary")}>
                              Internal Only
                            </FormLabel>
                            <div className="flex-1" />
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} className={field.value ? "data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500" : ""} />
                            </FormControl>
                          </div>
                          <span className="text-text-tertiary text-[11px] italic px-1">
                            {field.value ? "Hidden from delegators" : "Visible to all delegators"}
                          </span>
                        </FormItem>
                      )}
                    />

                    <div className="h-px bg-border-primary -mx-5" />

                    {/* Default Revenue Shares */}
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className={clsx("text-xs font-medium text-text-tertiary uppercase tracking-wide", !!form.formState.errors.defaultRevShare && "text-warning")}>
                          Default Revenue Shares
                        </span>
                        <span className="text-xs cursor-pointer hover:underline" style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
                          onClick={() => append({ address: '', share: '' })}>
                          Add Share
                        </span>
                      </div>

                      {/* Supplier Share */}
                      <div className="grid grid-cols-24 items-center gap-2">
                        <span className="col-span-17 text-xs text-text-secondary">Supplier Share</span>
                        <FormField
                          control={form.control}
                          name={'defaultRevShare.supplierShare'}
                          render={({field}) => (
                            <FormItem className="col-span-7">
                              <FormControl>
                                <Input type="number" min={1} max={100} {...field} placeholder="%" className="h-8 text-xs text-right" />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      {form.formState.errors.defaultRevShare?.supplierShare?.message && (
                        <p className="text-xs text-warning font-medium text-right">{form.formState.errors.defaultRevShare.supplierShare.message}</p>
                      )}

                      {/* Rev share rows */}
                      {fields.map((item, idx) => {
                        const liveAddrErr = liveErrors[`default.revShare.${idx}.address`]
                        const liveShareErr = liveErrors[`default.revShare.${idx}.share`]
                        const rowErr = liveAddrErr || liveShareErr
                        return (
                          <div key={item.id} className="flex flex-col gap-1">
                            <div className="grid grid-cols-24 items-center gap-2">
                              <FormField name={`defaultRevShare.revShare.${idx}.address`} control={form.control} render={({field}) => (
                                <FormItem className="col-span-17"><FormControl><Input className={clsx("h-8 text-xs", liveAddrErr && "border-red-500")} placeholder="pokt…" {...field} /></FormControl></FormItem>
                              )} />
                              <FormField control={form.control} name={`defaultRevShare.revShare.${idx}.share`} render={({field}) => (
                                <FormItem className="col-span-5"><FormControl><Input type="number" min={1} max={100} {...field} placeholder="%" className={clsx("h-8 text-xs", liveShareErr && "border-red-500")} /></FormControl></FormItem>
                              )} />
                              <Button variant="ghost" className="col-span-2 h-7" onClick={() => remove(idx)} size="icon">
                                <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                              </Button>
                            </div>
                            {rowErr && <p className="text-[10px] text-red-400">{rowErr}</p>}
                          </div>
                        )
                      })}
                      {(defaultRevShareError || liveErrors['default.total']) && (
                        <p className="text-xs text-red-400 font-medium">{liveErrors['default.total'] || defaultRevShareError}</p>
                      )}
                    </div>

                    <div className="h-px bg-border-primary -mx-5" />

                    {/* Linked Addresses */}
                    <FormField
                      name="linkedAddresses"
                      control={form.control}
                      render={() => (
                        <FormItem className="flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Linked Addresses</span>
                            <span className="text-xs cursor-pointer hover:underline" style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
                              onClick={() => form.setValue("linkedAddresses", [...(form.getValues("linkedAddresses") || []), ""], { shouldValidate: true })}>
                              Add Address
                            </span>
                          </div>
                          <FormControl>
                            <div className="flex flex-col gap-1.5">
                              {linkedAddresses && linkedAddresses.map((address, index) => {
                                const linkedErr = liveErrors[`linked.${index}`] || liveErrors[`linked.${index}.dup`]
                                return (
                                  <div key={index} className="flex flex-col gap-1">
                                    <div className="grid grid-cols-24 items-center gap-2">
                                      <Input
                                        className={clsx("col-span-22 h-8 text-xs", linkedErr && "border-red-500")}
                                        value={address}
                                        onChange={(e) => {
                                          const cur = [...form.getValues("linkedAddresses")];
                                          cur[index] = e.target.value;
                                          form.setValue("linkedAddresses", cur, { shouldValidate: true });
                                        }}
                                        placeholder="pokt..."
                                      />
                                      <Button variant="ghost" className="col-span-2 h-7" onClick={() => {
                                        const cur = [...form.getValues("linkedAddresses")];
                                        cur.splice(index, 1);
                                        form.setValue("linkedAddresses", cur, { shouldValidate: true });
                                      }} size="icon">
                                        <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                                      </Button>
                                    </div>
                                    {linkedErr && <p className="text-[10px] text-red-400">{linkedErr}</p>}
                                  </div>
                                )
                              })}
                              {(!linkedAddresses || linkedAddresses.length === 0) && (
                                <div className="text-text-tertiary text-[11px] italic">No linked addresses — visible to all delegators</div>
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="col-span-14 flex flex-col p-5 overflow-y-auto">
                    {/* Assign Services */}
                    <FormField
                      name="services"
                      control={form.control}
                      render={() => (
                        <FormItem className="flex flex-col gap-2 mb-4">
                          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Assign Services</span>
                          <FormControl>
                            <Combobox items={selectableServices} placeholder="Select a service..." searchPlaceholder="Search services" emptyMessage="No services found" onSelect={handleAddService} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {servicesOnForm.length > 0 ? (
                      <div className="space-y-4 border-t border-border-primary pt-4">
                        {servicesOnForm.map(({ serviceId, addSupplierShare, supplierShare, revShare, endpointOverrides }, index) => {
                          const service = services.find(
                            (s) => s.serviceId === serviceId
                          );
                          if (!service) return null;
                          return (
                            <ServiceItem
                              key={serviceId}
                              index={index}
                              service={service}
                              rm={selectedRelayMiner?.identity ?? ""}
                              region={selectedRelayMiner?.region?.urlValue ?? ""}
                              domain={selectedRelayMiner?.domain ?? ""}
                              revShare={revShare}
                              addSupplierShare={addSupplierShare}
                              supplierShare={supplierShare}
                              endpointOverrides={endpointOverrides ?? {}}
                              isNew={newServiceIds.has(serviceId)}
                              errors={Object.fromEntries(
                                Object.entries(liveErrors)
                                  .filter(([k]) => k.startsWith(`svc.${serviceId}.`))
                                  .map(([k, v]) => [k.replace(`svc.${serviceId}.`, ''), v])
                              )}
                              onRemove={() => handleRemoveService(serviceId)}
                              onAddSupplierShareChange={(
                                newAddSupplierShare: boolean
                              ) => {
                                const current = form.getValues(
                                  "services"
                                ) as AddressGroupService[];
                                form.setValue(
                                  "services",
                                  current.map((entry) =>
                                    entry.serviceId === serviceId
                                      ? {
                                        ...entry,
                                        supplierShare: newAddSupplierShare ? (entry.supplierShare || '') : '',
                                        addSupplierShare: newAddSupplierShare,
                                      }
                                      : entry
                                  ),
                                  { shouldValidate: true }
                                );
                              }}
                              onSupplierShareChange={(
                                newSupplierShare: string
                              ) => {
                                const current = form.getValues(
                                  "services"
                                ) as AddressGroupService[];
                                form.setValue(
                                  "services",
                                  current.map((entry) =>
                                    entry.serviceId === serviceId
                                      ? {
                                        ...entry,
                                        supplierShare: newSupplierShare,
                                      }
                                      : entry
                                  ),
                                  { shouldValidate: true }
                                );
                              }}
                              onRevShareChange={(
                                newRevShareArray: { address: string; share: string }[]
                              ) => {
                                const current = form.getValues(
                                  "services"
                                ) as AddressGroupService[];
                                form.setValue(
                                  "services",
                                  current.map((entry) =>
                                    entry.serviceId === serviceId
                                      ? {
                                        ...entry,
                                        revShare: newRevShareArray,
                                      }
                                      : entry
                                  ),
                                  { shouldValidate: true }
                                );
                              }}
                              onEndpointOverrideChange={(
                                rpcType: string, url: string
                              ) => {
                                const current = form.getValues(
                                  "services"
                                ) as AddressGroupService[];
                                form.setValue(
                                  "services",
                                  current.map((entry) =>
                                    entry.serviceId === serviceId
                                      ? {
                                        ...entry,
                                        endpointOverrides: {
                                          ...(entry.endpointOverrides ?? {}),
                                          [rpcType]: url,
                                        },
                                      }
                                      : entry
                                  ),
                                  { shouldValidate: true }
                                );
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm text-center">
                        No services assigned
                      </div>
                    )}
                  </div>
                </div>
              </form>
            </Form>
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center items-center">
            <LoaderIcon clasName="animate-spin" />
          </div>
        )}

        <div className="h-px bg-border-primary" />
        <DialogFooter className="px-5 py-3 flex flex-row items-center gap-2">
          {submitError && (
            <p className="text-xs text-red-400 flex-1">{submitError}</p>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={form.handleSubmit(onSubmit, (errors) => {
              // Extract first error message from nested form errors
              const firstError = (function findError(obj: any): string | null {
                if (!obj) return null
                if (obj.message && typeof obj.message === 'string') return obj.message
                for (const key of Object.keys(obj)) {
                  const found = findError(obj[key])
                  if (found) return found
                }
                return null
              })(errors)
              setSubmitError(firstError || 'Please fix the errors above.')
            })}
            disabled={isCreatingAddressGroup || isUpdatingAddressGroup || hasLiveErrors || (addressGroup && JSON.stringify(allValues) === JSON.stringify(form.formState.defaultValues))}
          >
            {addressGroup ? "Update Address Group" : "Add Address Group"}
          </Button>
        </DialogFooter>

        {isCancelling && (
          <div className="absolute inset-0 bg-background flex flex-col items-center justify-center p-6 animate-in fade-in">
            <h3 className="text-lg font-semibold mb-4">
              Are you sure you want to cancel?
            </h3>
            <p className="mb-6 text-muted-foreground text-center">
              Your changes for this Address Group will be discarded.
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

        {isCreatingAddressGroup && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background animate-fade-in z-10">
            <LoaderIcon className="animate-spin" />
            <p className="mt-4">Adding "{name}"</p>
          </div>
        )}

        {isUpdatingAddressGroup && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background animate-fade-in z-10">
            <LoaderIcon className="animate-spin" />
            <p className="mt-4">Updating "{name}"</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
