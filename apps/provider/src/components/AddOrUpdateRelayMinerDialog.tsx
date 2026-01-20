"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import React, { useCallback, useState } from "react";
import { LoaderIcon } from "@igniter/ui/assets";
import type { RelayMiner } from "@igniter/db/provider/schema";
import {CreateRelayMiner, UpdateRelayMiner} from "@/actions/RelayMiners";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@igniter/ui/components/select";
import { ListRegions } from "@/actions/Regions";
import { useQuery } from "@tanstack/react-query";

const CreateOrUpdateRelayMinerSchema = z.object({
    name: z
        .string()
        .min(1, "Name is required"),

    identity: z
        .string()
        .min(1, "Identity is required")
        .regex(
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            "Identity must be a valid slug (lowercase letters, numbers, and hyphens only, cannot start or end with a hyphen)"
        ),

    regionId: z.coerce.number(),

    domain: z
        .string()
        .min(1, "Domain is required")
        .regex(
            /^(?!:\/\/)([a-zA-Z0-9-_]+(\.[a-zA-Z0-9-_]+)+.*)$/,
            "Invalid domain format. Ensure it's a valid domain name."
        ),
});

export interface AddOrUpdateRelayMinerProps {
    onClose?: (shouldRefreshRelayMiners: boolean) => void;
    relayMiner?: RelayMiner;
}

export function AddOrUpdateRelayMinerDialog({
  onClose,
  relayMiner,
}: Readonly<AddOrUpdateRelayMinerProps>) {
  const [isCancelling, setIsCanceling] = useState(false);
  const [isCreatingRelayMiner, setIsCreatingRelayMiner] = useState(false);
  const [isUpdatingRelayMiner, setIsUpdatingRelayMiner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Add this query to fetch regions
  const { data: regions, isLoading: isLoadingRegions } = useQuery({
    queryKey: ['regions'],
    queryFn: async () => {
      const result = await ListRegions();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: []
  });

    const form = useForm<z.infer<typeof CreateOrUpdateRelayMinerSchema>>({
        resolver: zodResolver(CreateOrUpdateRelayMinerSchema),
        defaultValues: {
            name: relayMiner?.name ?? "",
            identity: relayMiner?.identity ?? "",
            regionId: relayMiner?.regionId,
            domain: relayMiner?.domain ?? "",
        },
    });

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

    async function onSubmit(values: z.infer<typeof CreateOrUpdateRelayMinerSchema>) {
        setError(null);

        if (relayMiner) {
            setIsUpdatingRelayMiner(true);
            try {
                const result = await UpdateRelayMiner(relayMiner.id, values);
                if (!result.success) {
                    throw new Error(result.error.message);
                }
                onClose?.(true);
            } catch (e) {
                console.error("Failed to update relay miner", e);
                setError(e instanceof Error ? e.message : "Failed to update relay miner. Make sure the combination of identity and region is unique and try again.");
            } finally {
                setIsUpdatingRelayMiner(false);
            }
        } else {
            setIsCreatingRelayMiner(true);
            try {
                const result = await CreateRelayMiner(values);
                if (!result.success) {
                    throw new Error(result.error.message);
                }
                onClose?.(true);
            } catch (e) {
                console.error("Failed to create relay miner", e);
                setError("Failed to create relay miner. Make sure the combination of identity and region is unique and try again.");
            } finally {
                setIsCreatingRelayMiner(false);
            }
        }
    }

    const isLoading = isCreatingRelayMiner || isUpdatingRelayMiner || isLoadingRegions;

    return (
        <Dialog open={true}>
            <DialogContent
                onInteractOutside={(e) => e.preventDefault()}
                className="gap-0 p-0 rounded-lg bg-[var(--color-slate-2)] !w-[500px] !min-w-none !max-w-none"
                hideClose
            >
                <DialogTitle asChild>
                    <div className="flex flex-row justify-between items-center py-4 px-4">
                        <span className="text-[14px]">
                          {relayMiner
                              ? `Update Relay Miner: ${relayMiner.name}`
                              : "Add New Relay Miner"}
                        </span>
                    </div>
                </DialogTitle>
                {!error && (
                    <div className="h-[1px] bg-[var(--slate-dividers)]" />
                )}
                {error && (
                    <div
                        className={'flex flex-col text-center bg-[color:var(--color-black-1)]'}
                    >
                        <div className={'flex items-center'}>
                            <div className={'flex flex-row items-center p-1'}>
                                {error}
                            </div>
                        </div>
                        <div className="!min-h-0.5 !h-[2px] w-full bg-linear-to-r from-[color:#f97834] to-[color:#f8a23e]" />
                    </div>
                )}
                <div className="px-4 py-3">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                            <div className="flex flex-col gap-4">
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

                                {/* Identity */}
                                <FormField
                                    name="identity"
                                    control={form.control}
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col gap-2">
                                            <FormLabel>Identity</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="URL compatible identity. E.g. rm-01"/>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Region */}
                                <FormField
                                    name="regionId"
                                    control={form.control}
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col gap-2">
                                            <FormLabel>Region</FormLabel>
                                            <FormControl>
                                                {!isLoadingRegions && (
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        defaultValue={field.value?.toString()}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder={regions && regions.length > 0 ? "Select a region" : "No regions configured"}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {regions.map((region) => (
                                                                <SelectItem key={region.id} value={region.id.toString()}>
                                                                    {region.displayName}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Domain */}
                                <FormField
                                    name="domain"
                                    control={form.control}
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col gap-2">
                                            <FormLabel>Domain</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="e.g., example.com" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <DialogFooter className="pt-4">
                                <Button
                                    variant="outline"
                                    onClick={handleCancel}
                                    disabled={isLoading}
                                    type="button"
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={isLoading}>
                                    {isLoading && (
                                        <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    {relayMiner ? "Update" : "Create"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>

                {isCancelling && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
                        <div className="bg-[var(--color-slate-2)] p-4 rounded-lg w-[300px]">
                            <h3 className="text-lg font-medium mb-2">Discard changes?</h3>
                            <p className="mb-4">
                                You have unsaved changes. Are you sure you want to discard them?
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsCanceling(false)}
                                >
                                    Continue Editing
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => onClose?.(false)}
                                >
                                    Discard
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
