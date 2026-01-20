"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useFormContext } from 'react-hook-form'
import { z } from "zod";
import { Button } from "@igniter/ui/components/button";
import {
  Form,
  FormControl,
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
    return !isNaN(num) && num >= 1 && num <= 100;
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
}).refine((value) => {
  return !value.addSupplierShare || !!value.supplierShare
}, {
  path: ['supplierShare'],
  message: 'Required',
}).refine((value) => {
  if (value.addSupplierShare) {
    const num = Number(value.supplierShare);

    return !isNaN(num) && num >= 1 && num <= 100;
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
    return !value.addSupplierShare || !!value.supplierShare
  }, {
    path: ['supplierShare'],
    message: 'Required',
  }).refine((value) => {
    if (value.addSupplierShare) {
      const num = Number(value.supplierShare);

      return !isNaN(num) && num >= 1 && num <= 100;
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
  rm: string;
  region: string;
  domain: string;
  onRemove: () => void;
  onRevShareChange: (newRevShare: { address: string; share: string }[]) => void;
  onAddSupplierShareChange: (newAddSupplierShare: boolean) => void;
  onSupplierShareChange: (newSupplierShare: string) => void;
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
                       onRemove,
                       onRevShareChange,
                       onAddSupplierShareChange,
                       onSupplierShareChange,
                     }: Readonly<ServiceItemProps>) => {
  const {formState} = useFormContext<z.infer<typeof CreateOrUpdateAddressGroupSchema>>()

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
      className="grid gap-2 p-3 border border-[var(--slate-dividers)] rounded-md"
    >
      <div className="flex justify-between px-1">
        <span
          className={
            clsx(
              'text-sm font-medium',
              !!serviceError && 'text-warning'
            )
          }
        >
          {service.name} ({service.serviceId})
        </span>
        <FormLabel
          className="text-[var(--color-slate-9)] hover:underline cursor-pointer"
          onClick={onRemove}
        >
          Remove
        </FormLabel>
      </div>

      {service.endpoints && service.endpoints.length > 0 && (
        <div className="space-y-2 mt-2">
          {service.endpoints.map((endpoint, index) => (
            <div key={index} className="text-sm pl-2">
              {getEndpointInterpolatedUrl(endpoint, {
                sid: service.serviceId,
                rm,
                region,
                domain,
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t pt-2">
        <div className="flex justify-between px-1">
          <span className="text-sm font-medium">
            Revenue Shares
          </span>
          <FormLabel
            className="text-[var(--color-slate-9)] hover:underline cursor-pointer"
            onClick={handleAddRevShare}
          >
            Add Share
          </FormLabel>
        </div>
        <div className="grid grid-cols-24 items-center gap-2 mt-2">
          <div className="col-span-19">
            <span className="flex items-center gap-2">
              <Switch
                checked={addSupplierShare}
                onCheckedChange={onAddSupplierShareChange}
                className="border-[var(--slate-dividers)]"
              />
              <Label>Add Supplier Share</Label>
            </span>
          </div>
          <span className="col-span-5">
            <Input
              type="number"
              min={1}
              max={100}
              value={supplierShare ?? ''}
              disabled={!addSupplierShare}
              onChange={(e) =>
                onSupplierShareChange(e.target.value)
              }
              placeholder="%"
            />
          </span>
        </div>
        <div className="grid grid-cols-24 items-center gap-2 mt-2"></div>
        {revShare.map((item, idx) => (
          <div key={idx} className="grid grid-cols-24 items-center gap-2 mt-2">
            <Input
              className="col-span-18"
              value={item.address}
              onChange={(e) => handleChangeAddress(idx, e.target.value)}
              placeholder="pokt…"
            />
            <Input
              className="col-span-4"
              type="number"
              min={1}
              max={100}
              value={item.share ?? ''}
              onChange={(e) =>
                handleChangePercent(idx, e.target.value)
              }
              placeholder="%"
            />

            <Button
              className="col-span-2"
              onClick={() => handleRemoveRevShare(idx)}
              size="sm"
            >
              x
            </Button>
          </div>

        ))}
      </div>
      {serviceError && (
        <p className={'text-sm mt-2 text-warning font-medium'}>
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
        })) ?? [],
    },
  });

  const [defaultAddSupplierShare] = form.watch(['defaultRevShare.addSupplierShare'])

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
          ...currentServices,
          { serviceId, ...form.getValues('defaultRevShare')},
        ]);
      }
    },
    [form]
  );

  const handleRemoveService = useCallback(
    (serviceId: string) => {
      const currentServices = form.getValues("services");
      form.setValue(
        "services",
        currentServices.filter((s) => s.serviceId !== serviceId)
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

  const selectedRelayMiner = useMemo(() => {
    return relayMiners.find((rm) => rm.id === Number(relayMinerId));
  }, [relayMinerId]);

  async function onSubmit({services, ...values}: z.infer<typeof CreateOrUpdateAddressGroupSchema>) {
    if (addressGroup) {
      setIsUpdatingAddressGroup(true);
      try {
        const result = await UpdateAddressGroup(
          addressGroup.id,
          values,
          services.map((s) => ({
            ...s,
            supplierShare: s.supplierShare ? Number(s.supplierShare) : null,
            revShare: s.revShare.map((rs) => ({
              address: rs.address,
              share: Number(rs.share),
            }))
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
            supplierShare: s.supplierShare ? Number(s.supplierShare) : null,
            revShare: s.revShare.map((rs) => ({
              address: rs.address,
              share: Number(rs.share),
            }))
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
        className="gap-0 p-0 rounded-lg bg-[var(--color-slate-2)] !w-[900px] !min-w-none !max-w-none h-[670px]"
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-4 px-4">
            <span className="text-[14px]">
              {addressGroup
                ? `Update AddressGroup: ${addressGroup.name}`
                : "Add New AddressGroup"}
            </span>
          </div>
        </DialogTitle>
        <div className="h-[1px] bg-[var(--slate-dividers)]" />

        {!isLoading && (
          <div className="px-4 py-3 min-h-[570px]">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                <div className="grid grid-cols-24 gap-1">
                  <div className="col-span-11 flex flex-col gap-4 px-2 !max-h-[550px] overflow-y-auto">
                    {/* Name */}
                    <FormField
                      name="name"
                      control={form.control}
                      render={({ field }) => (
                        <FormItem className="flex flex-col gap-2">
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                        name="relayMinerId"
                        control={form.control}
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-2">
                              <FormLabel>Relay Miner</FormLabel>
                              <FormControl>
                                <Select
                                    onValueChange={field.onChange}
                                    defaultValue={String(field.value ?? "")}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {relayMiners.map((rm) => (
                                        <SelectItem key={rm.identity} value={rm.id.toString()}>{`${rm.name} (${rm.identity} - ${rm.region.displayName})`}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="">
                      <div className="flex justify-between">
                        <span
                          className={
                            clsx(
                              "text-sm font-medium",
                              !!form.formState.errors.defaultRevShare && "text-warning"
                            )
                          }
                        >
                          Default Revenue Shares
                        </span>
                        <Button
                          variant={'ghost'}
                          type={'button'}
                          className="text-[var(--color-slate-9)] hover:underline cursor-pointer p-0 h-auto hover:bg-transparent"
                          onClick={() => {
                            append({
                              address: '',
                              share: '',
                            })
                          }}
                        >
                          Add Share
                        </Button>
                      </div>

                      <div
                        className="grid gap-2 mt-2 p-3 border border-[var(--slate-dividers)] rounded-md"
                      >
                        <div className="grid grid-cols-24 items-center gap-2">
                          <FormField
                            control={form.control}
                            name={'defaultRevShare.addSupplierShare'}
                            render={({field: {value, onChange, ...field}}) => (
                              <FormItem className={'flex flex-row items-center col-span-19 gap-2'}>
                                <FormControl>
                                  <Switch
                                    {...field}
                                    checked={value}
                                    onCheckedChange={(value) => {
                                      onChange(value);
                                      form.clearErrors('defaultRevShare.supplierShare')
                                      form.setValue('defaultRevShare.supplierShare', '')
                                      if (value) {
                                        setTimeout(() => {
                                          form.setFocus('defaultRevShare.supplierShare')
                                        }, 0)
                                      }
                                    }}
                                    className="border-[var(--slate-dividers)] m-0"
                                  />
                                </FormControl>
                                <FormLabel>
                                  Add Supplier Share
                                </FormLabel>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={'defaultRevShare.supplierShare'}
                            render={({field}) => (
                              <FormItem className={'col-span-5'}>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={100}
                                    {...field}
                                    disabled={field.disabled || !defaultAddSupplierShare}
                                    placeholder="%"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          {
                            form.formState.errors.defaultRevShare?.supplierShare?.message && (
                              <p className={'text-sm text-warning font-medium col-span-24 -mt-1 text-right'}>
                                {form.formState.errors.defaultRevShare?.supplierShare?.message}
                              </p>
                            )
                          }
                          {
                            fields.map((item, idx) => {
                              let errorMessage = '', right = false;

                              if (form.formState.errors.defaultRevShare?.revShare?.[idx]?.address?.message) {
                                errorMessage = form.formState.errors.defaultRevShare.revShare[idx].address.message
                              } else if (form.formState.errors.defaultRevShare?.revShare?.[idx]?.share?.message) {
                                right = true
                                errorMessage = form.formState.errors.defaultRevShare?.revShare[idx].share.message
                              }

                              return (
                                <div key={item.id} className="grid col-span-24 grid-cols-24 items-center gap-2 mt-2">
                                  <FormField
                                    name={`defaultRevShare.revShare.${idx}.address`}
                                    control={form.control}
                                    render={({field}) => (
                                      <FormItem className={'col-span-18'}>
                                        <FormControl>
                                          <Input
                                            className="col-span-18"
                                            placeholder="pokt…"
                                            {...field}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name={`defaultRevShare.revShare.${idx}.share`}
                                    render={({field}) => (
                                      <FormItem className={'col-span-4'}>
                                        <Input
                                          type="number"
                                          min={1}
                                          max={100}
                                          {...field}
                                          placeholder="%"
                                        />
                                      </FormItem>
                                    )}
                                  />
                                  <Button
                                    className="col-span-2"
                                    onClick={() => remove(idx)}
                                    size="sm"
                                  >
                                    x
                                  </Button>
                                  {errorMessage && (
                                    <p
                                      className={
                                        clsx(
                                          'text-sm -mt-1 pl-2 text-warning font-medium col-span-24',
                                          right && 'text-right'
                                        )
                                      }
                                    >
                                      {errorMessage}
                                    </p>
                                  )}
                                </div>
                              )
                            })
                          }
                        </div>
                        {defaultRevShareError && (
                          <p className={'text-sm mt-2 text-warning font-medium'}>
                            {defaultRevShareError}
                          </p>
                        )}
                      </div>
                    </div>

                    <FormField
                      name="services"
                      control={form.control}
                      render={() => (
                        <FormItem className="flex flex-col gap-2">
                          <FormLabel className={'!text-foreground'}>Assign services</FormLabel>
                          <FormControl>
                            <Combobox
                              items={selectableServices}
                              placeholder="Select"
                              searchPlaceholder="Search services"
                              emptyMessage="No services found"
                              onSelect={handleAddService}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="private"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md p-4">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="border-[var(--slate-dividers)]"
                            />
                          </FormControl>
                          <FormLabel>Internal use only</FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                        name="linkedAddresses"
                        control={form.control}
                        render={() => (
                            <FormItem className="flex flex-col gap-2">
                              <div className="flex justify-between">
                                <FormLabel>Linked Addresses</FormLabel>
                                <FormLabel
                                    className="text-[var(--color-slate-9)] hover:underline cursor-pointer"
                                    onClick={() => {
                                      const currentAddresses = form.getValues("linkedAddresses");
                                      form.setValue("linkedAddresses", [...currentAddresses, ""]);
                                    }}
                                >
                                  Add Address
                                </FormLabel>
                              </div>
                              <FormControl>
                                <div className="space-y-2">
                                  {linkedAddresses && linkedAddresses.map((address, index) => (
                                      <div key={index} className="grid grid-cols-24 items-center gap-2">
                                        <Input
                                            className="col-span-22"
                                            value={address}
                                            onChange={(e) => {
                                              const currentAddresses = [...form.getValues("linkedAddresses")];
                                              currentAddresses[index] = e.target.value;
                                              form.setValue("linkedAddresses", currentAddresses);
                                            }}
                                            placeholder="pokt..."
                                        />
                                        <Button
                                            className="col-span-2"
                                            onClick={() => {
                                              const currentAddresses = [...form.getValues("linkedAddresses")];
                                              currentAddresses.splice(index, 1);
                                              form.setValue("linkedAddresses", currentAddresses);
                                            }}
                                            size="sm"
                                        >
                                          x
                                        </Button>
                                      </div>
                                  ))}
                                  {linkedAddresses && linkedAddresses.length === 0 && (
                                      <div className="text-muted-foreground text-sm">
                                        No linked addresses added
                                      </div>
                                  )}
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                        )}
                    />
                  </div>

                  <div className="col-span-13 flex flex-col gap-4 px-2 !max-h-[550px] overflow-y-auto">
                    {servicesOnForm.length > 0 ? (
                      <div className="space-y-4">
                        {servicesOnForm.map(({ serviceId, addSupplierShare, supplierShare, revShare }, index) => {
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
                                  )
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
                                  )
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
                                  )
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

        <div className="h-[1px] bg-[var(--slate-dividers)]" />
        <DialogFooter className="p-2 flex flex-row ">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={form.handleSubmit(onSubmit)}
            disabled={isCreatingAddressGroup || isUpdatingAddressGroup}
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
